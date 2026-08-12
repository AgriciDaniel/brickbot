"use client"

import type React from "react"

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { getSettings, MIC_SENS_THRESHOLD } from "@/lib/phone-settings"

export type CallStatus = "offline" | "idle" | "listening" | "recording" | "transcribing" | "thinking" | "speaking"

export interface TranscriptLine {
  role: "you" | "claude" | "system"
  text: string
}

export interface SpeechTiming {
  words: string[]
  wtimes: number[]
  wdurations: number[]
}

interface AgentCallContextType {
  status: CallStatus
  transcript: TranscriptLine[]
  liveCall: boolean
  callStartedAt: number | null
  suggestions: string[]
  chooseSuggestion: (index: number) => void
  toggleTalk: () => void
  toggleLive: () => void
  hangUp: () => void
  // Refs used by the avatar for lip-sync and level bars (read in rAF loops, never re-render)
  audioRef: React.MutableRefObject<HTMLAudioElement | null>
  timingRef: React.MutableRefObject<SpeechTiming | null>
  analyserRef: React.MutableRefObject<AnalyserNode | null>
  micAnalyserRef: React.MutableRefObject<AnalyserNode | null>
}

const AgentCallContext = createContext<AgentCallContextType | undefined>(undefined)

const BRIDGE_URL = "ws://localhost:3010"

// Live-call voice activity detection tuning
const VAD_START_FRAMES = 3 // consecutive voiced 50ms frames before we call it speech
const VAD_SILENCE_MS = 1200 // pause length that ends an utterance
const VAD_IDLE_RESTART_MS = 30000 // recycle the recorder if nobody spoke
const VAD_MAX_UTTERANCE_MS = 45000 // failsafe: force-send very long utterances

export function AgentCallProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<CallStatus>("offline")
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])
  const [liveCall, setLiveCall] = useState(false)
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const suggestionsRef = useRef<string[]>([])

  const setSuggestionsSafe = (s: string[]) => {
    suggestionsRef.current = s
    setSuggestions(s)
  }

  const wsRef = useRef<WebSocket | null>(null)
  const msgIdRef = useRef(1)
  const statusRef = useRef<CallStatus>("offline")

  // Push-to-talk recording
  const recorderRef = useRef<MediaRecorder | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const discardRecordingRef = useRef(false)

  // Live call
  const liveRef = useRef(false)
  const liveStreamRef = useRef<MediaStream | null>(null)
  const liveRecorderRef = useRef<MediaRecorder | null>(null)
  const micAnalyserRef = useRef<AnalyserNode | null>(null)
  const vadIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // TTS playback
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const timingRef = useRef<SpeechTiming | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)

  const setStatusSafe = (s: CallStatus) => {
    statusRef.current = s
    setStatus(s)
  }

  const addLine = (line: TranscriptLine) => {
    setTranscript((prev) => [...prev.slice(-200), line])
  }

  // ── WebSocket connection with auto-reconnect ──
  useEffect(() => {
    let closed = false
    let retryTimer: ReturnType<typeof setTimeout>

    const connect = () => {
      const ws = new WebSocket(BRIDGE_URL)
      wsRef.current = ws

      ws.onopen = () => {
        if (wsRef.current !== ws) return // stale socket from a previous mount
        if (statusRef.current === "offline") setStatusSafe("idle")
      }

      ws.onmessage = (event) => {
        if (wsRef.current !== ws) return
        let msg: any
        try {
          msg = JSON.parse(event.data)
        } catch {
          return
        }
        handleBridgeEvent(msg)
      }

      ws.onclose = () => {
        // A stale socket closing must not clobber the live one (hot-reload race)
        if (wsRef.current !== ws) return
        wsRef.current = null
        endLive()
        setStatusSafe("offline")
        if (!closed) retryTimer = setTimeout(connect, 2000)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()
    return () => {
      closed = true
      clearTimeout(retryTimer)
      const ws = wsRef.current
      wsRef.current = null // mark stale before closing so its onclose is ignored
      ws?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const backToReady = () => {
    if (liveRef.current) {
      beginListenCycle()
    } else {
      setStatusSafe("idle")
    }
  }

  const handleBridgeEvent = (msg: any) => {
    switch (msg.type) {
      case "transcribing":
        setStatusSafe("transcribing")
        break
      case "transcript":
        if (msg.text && msg.text.trim()) {
          addLine({ role: "you", text: msg.text.trim() })
          setStatusSafe("thinking")
        } else {
          backToReady()
        }
        break
      case "stream":
        setStatusSafe("thinking")
        break
      case "result": {
        // Peel off the IVR options line: ">>> 1) a | 2) b | 3) c"
        let content: string = msg.content || ""
        const m = content.match(/>>>\s*1\)\s*([^|]+?)\s*\|\s*2\)\s*([^|]+?)\s*\|\s*3\)\s*(.+?)\s*$/s)
        if (m) {
          setSuggestionsSafe([m[1].trim(), m[2].trim(), m[3].trim()])
          content = content.replace(/>>>[\s\S]*$/, "").trim()
        } else {
          setSuggestionsSafe([])
        }
        if (content) addLine({ role: "claude", text: content })
        if (msg.tts && msg.tts.audio) {
          playSpeech(msg.tts)
        } else {
          backToReady()
        }
        break
      }
      case "error":
        addLine({ role: "system", text: "error: " + (msg.message || "unknown") })
        backToReady()
        break
    }
  }

  // ── TTS playback with analyser for the LCD bars ──
  const ensureAudioGraph = () => {
    if (!audioRef.current) {
      const el = new Audio()
      el.crossOrigin = "anonymous"
      audioRef.current = el
      const Ctx = window.AudioContext || (window as any).webkitAudioContext
      const ctx: AudioContext = new Ctx()
      audioCtxRef.current = ctx
      const source = ctx.createMediaElementSource(el)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.4
      source.connect(analyser)
      analyser.connect(ctx.destination)
      analyserRef.current = analyser
    }
    audioCtxRef.current?.resume()
  }

  const playSpeech = (tts: { audio: string; words: string[]; wtimes: number[]; wdurations: number[] }) => {
    ensureAudioGraph()
    const el = audioRef.current!
    timingRef.current = { words: tts.words || [], wtimes: tts.wtimes || [], wdurations: tts.wdurations || [] }
    el.src = "data:audio/mpeg;base64," + tts.audio
    el.onended = () => {
      timingRef.current = null
      // Small gap so the speaker tail doesn't trigger the mic
      if (liveRef.current) setTimeout(backToReady, 350)
      else setStatusSafe("idle")
    }
    el.play()
      .then(() => setStatusSafe("speaking"))
      .catch(() => {
        timingRef.current = null
        backToReady()
      })
  }

  const stopSpeech = () => {
    const el = audioRef.current
    if (el) {
      el.pause()
      el.currentTime = 0
      el.onended = null
    }
    timingRef.current = null
  }

  const stopListenCycleSilent = () => {
    if (vadIntervalRef.current) clearInterval(vadIntervalRef.current)
    const recorder = liveRecorderRef.current
    if (recorder && recorder.state === "recording") {
      recorder.onstop = null
      recorder.stop()
    }
    liveRecorderRef.current = null
  }

  const chooseSuggestion = (index: number) => {
    const text = suggestionsRef.current[index]
    if (!text) return
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    const s = statusRef.current
    if (s === "transcribing" || s === "thinking") return // request already in flight
    if (s === "speaking") stopSpeech()
    if (liveRef.current) stopListenCycleSilent()
    setSuggestionsSafe([])
    addLine({ role: "you", text })
    setStatusSafe("thinking")
    ws.send(JSON.stringify({ id: msgIdRef.current++, type: "chat", text, voice: getSettings().voice }))
  }

  const sendAudioBlob = (blob: Blob) => {
    setSuggestionsSafe([])
    const reader = new FileReader()
    reader.onloadend = () => {
      const dataUrl = reader.result as string
      const base64 = dataUrl.split(",")[1] || ""
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN && base64) {
        setStatusSafe("transcribing")
        ws.send(
          JSON.stringify({ id: msgIdRef.current++, type: "transcribe", audio: base64, voice: getSettings().voice }),
        )
      } else {
        addLine({ role: "system", text: "bridge not connected" })
        if (liveRef.current) {
          // Can't continue a live call without the bridge: hang up cleanly
          endLive()
        } else {
          setStatusSafe(ws && ws.readyState === WebSocket.OPEN ? "idle" : "offline")
        }
      }
    }
    reader.readAsDataURL(blob)
  }

  // ── Push-to-talk recording ──
  const startRecording = async () => {
    ensureAudioGraph() // user gesture: unlock audio for later playback
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      micStreamRef.current = stream
      // Level meter so the LCD can show the mic is picking you up
      const ctx = audioCtxRef.current
      if (ctx) {
        const source = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        analyser.smoothingTimeConstant = 0.3
        source.connect(analyser) // never to destination: no feedback
        micAnalyserRef.current = analyser
      }
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" })
      recorderRef.current = recorder
      discardRecordingRef.current = false
      const chunks: Blob[] = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        micStreamRef.current = null
        recorderRef.current = null
        micAnalyserRef.current = null

        if (discardRecordingRef.current) {
          setStatusSafe("idle")
          return
        }
        sendAudioBlob(new Blob(chunks, { type: "audio/webm" }))
      }

      recorder.start()
      setSuggestionsSafe([])
      setStatusSafe("recording")
    } catch {
      addLine({ role: "system", text: "mic access denied" })
    }
  }

  const stopRecording = (discard: boolean) => {
    discardRecordingRef.current = discard
    recorderRef.current?.stop()
  }

  // ── Live call: hands-free VAD loop ──
  const beginListenCycle = () => {
    if (!liveRef.current || !liveStreamRef.current) return
    const stream = liveStreamRef.current

    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" })
    liveRecorderRef.current = recorder
    const chunks: Blob[] = []
    let hadSpeech = false
    let sendOnStop = false

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }

    recorder.onstop = () => {
      liveRecorderRef.current = null
      if (!liveRef.current) return
      if (sendOnStop && hadSpeech) {
        sendAudioBlob(new Blob(chunks, { type: "audio/webm" }))
      } else {
        // Nothing worth sending: recycle the recorder
        beginListenCycle()
      }
    }

    const cycleStart = Date.now()
    let voicedFrames = 0
    let speechStart = 0
    let lastVoice = 0

    const data = new Uint8Array(512)
    if (vadIntervalRef.current) clearInterval(vadIntervalRef.current)
    vadIntervalRef.current = setInterval(() => {
      if (!liveRef.current || recorder.state !== "recording") {
        if (vadIntervalRef.current) clearInterval(vadIntervalRef.current)
        return
      }
      const analyser = micAnalyserRef.current
      if (!analyser) return
      analyser.getByteTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / data.length)
      const now = Date.now()

      if (rms > MIC_SENS_THRESHOLD[getSettings().micSens]) {
        voicedFrames++
        lastVoice = now
        if (!hadSpeech && voicedFrames >= VAD_START_FRAMES) {
          hadSpeech = true
          speechStart = now
          setSuggestionsSafe([])
          setStatusSafe("recording")
        }
      } else {
        voicedFrames = 0
      }

      const stop = (send: boolean) => {
        if (vadIntervalRef.current) clearInterval(vadIntervalRef.current)
        sendOnStop = send
        recorder.stop()
      }

      if (hadSpeech && now - lastVoice > VAD_SILENCE_MS) stop(true)
      else if (hadSpeech && now - speechStart > VAD_MAX_UTTERANCE_MS) stop(true)
      else if (!hadSpeech && now - cycleStart > VAD_IDLE_RESTART_MS) stop(false)
    }, 50)

    recorder.start()
    setStatusSafe("listening")
  }

  const forceSendLiveUtterance = () => {
    // Center key during a live call: send what we have right now
    const recorder = liveRecorderRef.current
    if (recorder && recorder.state === "recording") {
      if (vadIntervalRef.current) clearInterval(vadIntervalRef.current)
      // beginListenCycle's onstop only sends when hadSpeech; recreate a direct path
      recorder.onstop = null
      const chunks: Blob[] = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }
      recorder.addEventListener("stop", () => {
        liveRecorderRef.current = null
        if (liveRef.current) sendAudioBlob(new Blob(chunks, { type: "audio/webm" }))
      })
      recorder.requestData()
      recorder.stop()
    }
  }

  const startLive = async () => {
    if (liveRef.current || statusRef.current === "offline") return
    ensureAudioGraph()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      liveStreamRef.current = stream
      const ctx = audioCtxRef.current!
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.3
      source.connect(analyser) // never to destination: no feedback
      micAnalyserRef.current = analyser

      liveRef.current = true
      setLiveCall(true)
      setCallStartedAt(Date.now())
      addLine({ role: "system", text: "call started" })
      beginListenCycle()
    } catch {
      addLine({ role: "system", text: "mic access denied" })
    }
  }

  const endLive = () => {
    if (!liveRef.current) return
    liveRef.current = false
    setLiveCall(false)
    setCallStartedAt(null)
    if (vadIntervalRef.current) clearInterval(vadIntervalRef.current)
    const recorder = liveRecorderRef.current
    if (recorder && recorder.state === "recording") {
      recorder.onstop = null
      recorder.stop()
    }
    liveRecorderRef.current = null
    liveStreamRef.current?.getTracks().forEach((t) => t.stop())
    liveStreamRef.current = null
    micAnalyserRef.current = null
    stopSpeech()
    addLine({ role: "system", text: "call ended" })
    setStatusSafe(wsRef.current && wsRef.current.readyState === WebSocket.OPEN ? "idle" : "offline")
  }

  // ── Public controls ──
  const toggleTalk = () => {
    const s = statusRef.current

    if (liveRef.current) {
      // On a live call the center key nudges the flow along
      if (s === "speaking") {
        stopSpeech()
        beginListenCycle()
      } else if (s === "recording") {
        forceSendLiveUtterance()
      }
      return
    }

    if (s === "recording") {
      stopRecording(false)
    } else if (s === "idle") {
      startRecording()
    } else if (s === "speaking") {
      // Interrupt Claude and immediately start talking
      stopSpeech()
      startRecording()
    }
    // offline / transcribing / thinking: ignore
  }

  const toggleLive = () => {
    if (liveRef.current) endLive()
    else startLive()
  }

  const hangUp = () => {
    if (liveRef.current) {
      endLive()
      return
    }
    const s = statusRef.current
    if (s === "recording") {
      stopRecording(true)
    } else if (s === "speaking") {
      stopSpeech()
      setStatusSafe("idle")
    }
  }

  return (
    <AgentCallContext.Provider
      value={{
        status,
        transcript,
        liveCall,
        callStartedAt,
        suggestions,
        chooseSuggestion,
        toggleTalk,
        toggleLive,
        hangUp,
        audioRef,
        timingRef,
        analyserRef,
        micAnalyserRef,
      }}
    >
      {children}
    </AgentCallContext.Provider>
  )
}

export function useAgentCall() {
  const context = useContext(AgentCallContext)
  if (context === undefined) {
    throw new Error("useAgentCall must be used within an AgentCallProvider")
  }
  return context
}
