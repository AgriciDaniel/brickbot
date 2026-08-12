"use client"

import { useEffect, useRef, useState } from "react"
import { useAgentCall } from "@/contexts/agent-call-context"

// Nokia-LCD pixel avatar. Drawn on a 20x14 grid as SVG rects in the LCD ink
// color, lip-synced from the edge-tts word timings supplied by the bridge.

const CELL = 5
const COLS = 20
const ROWS = 14

type Px = [x: number, y: number, w?: number, h?: number]

// Head outline (rounded rectangle, hand-placed pixels)
const HEAD: Px[] = [
  [6, 0, 8, 1],
  [4, 1, 2, 1],
  [14, 1, 2, 1],
  [3, 2, 1, 1],
  [16, 2, 1, 1],
  [2, 3, 1, 8],
  [17, 3, 1, 8],
  [3, 11, 1, 1],
  [16, 11, 1, 1],
  [4, 12, 2, 1],
  [14, 12, 2, 1],
  [6, 13, 8, 1],
]

// Antenna to make it read as "the agent inside the phone"
const ANTENNA: Px[] = [[9, 0, 2, 1]]

const EYES_OPEN: Px[] = [
  [6, 5, 3, 2],
  [11, 5, 3, 2],
]
const EYES_CLOSED: Px[] = [
  [6, 6, 3, 1],
  [11, 6, 3, 1],
]
const EYES_LOOK_LEFT: Px[] = [
  [5, 5, 3, 2],
  [10, 5, 3, 2],
]
const EYES_LOOK_RIGHT: Px[] = [
  [7, 5, 3, 2],
  [12, 5, 3, 2],
]

const MOUTH_CLOSED: Px[] = [[7, 10, 6, 1]]
const MOUTH_HALF: Px[] = [
  [7, 9, 6, 1],
  [8, 10, 4, 1],
]
const MOUTH_OPEN: Px[] = [
  [8, 8, 4, 1],
  [7, 9, 1, 2],
  [12, 9, 1, 2],
  [8, 11, 4, 1],
]

function Pixels({ pixels }: { pixels: Px[] }) {
  return (
    <>
      {pixels.map(([x, y, w = 1, h = 1], i) => (
        <rect key={i} x={x * CELL} y={y * CELL} width={w * CELL} height={h * CELL} fill="currentColor" />
      ))}
    </>
  )
}

export function PixelAvatar() {
  const { status, audioRef, timingRef } = useAgentCall()
  const [blink, setBlink] = useState(false)
  const [mouthFrame, setMouthFrame] = useState(0) // 0 closed, 1 half, 2 open
  const [gaze, setGaze] = useState<"center" | "left" | "right">("center")

  // Blink loop
  useEffect(() => {
    let blinkTimer: ReturnType<typeof setTimeout>
    let openTimer: ReturnType<typeof setTimeout>
    const schedule = () => {
      blinkTimer = setTimeout(() => {
        setBlink(true)
        openTimer = setTimeout(() => {
          setBlink(false)
          schedule()
        }, 150)
      }, 2500 + Math.random() * 2500)
    }
    schedule()
    return () => {
      clearTimeout(blinkTimer)
      clearTimeout(openTimer)
    }
  }, [])

  // Thinking: eyes wander
  useEffect(() => {
    if (status !== "thinking" && status !== "transcribing") {
      setGaze("center")
      return
    }
    const interval = setInterval(() => {
      setGaze((prev) => (prev === "left" ? "right" : "left"))
    }, 600)
    return () => clearInterval(interval)
  }, [status])

  // Speaking: mouth follows word timings via rAF
  useEffect(() => {
    if (status !== "speaking") {
      setMouthFrame(0)
      return
    }
    let raf: number
    const tick = () => {
      const el = audioRef.current
      const timing = timingRef.current
      let frame = 0
      if (el && timing && !el.paused) {
        const t = el.currentTime * 1000
        for (let i = 0; i < timing.wtimes.length; i++) {
          if (t >= timing.wtimes[i] && t <= timing.wtimes[i] + timing.wdurations[i]) {
            // Alternate half/open while inside a word so the mouth chatters
            frame = Math.floor(t / 130) % 2 === 0 ? 2 : 1
            break
          }
        }
      }
      setMouthFrame(frame)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [status, audioRef, timingRef])

  const eyes = blink
    ? EYES_CLOSED
    : gaze === "left"
      ? EYES_LOOK_LEFT
      : gaze === "right"
        ? EYES_LOOK_RIGHT
        : EYES_OPEN

  const mouth = mouthFrame === 2 ? MOUTH_OPEN : mouthFrame === 1 ? MOUTH_HALF : MOUTH_CLOSED

  return (
    <svg
      width={COLS * CELL}
      height={ROWS * CELL}
      viewBox={`0 0 ${COLS * CELL} ${ROWS * CELL}`}
      shapeRendering="crispEdges"
      aria-label="Claude pixel avatar"
    >
      <Pixels pixels={HEAD} />
      <Pixels pixels={ANTENNA} />
      <Pixels pixels={eyes} />
      <Pixels pixels={mouth} />
    </svg>
  )
}

// Small real-audio level bars for the LCD, fed by whichever analyser is handed in.
function useLevelBars(analyserRef: React.MutableRefObject<AnalyserNode | null>, active: boolean) {
  const [levels, setLevels] = useState<number[]>([0.1, 0.1, 0.1, 0.1, 0.1])

  useEffect(() => {
    if (!active) {
      setLevels([0.1, 0.1, 0.1, 0.1, 0.1])
      return
    }
    let raf: number
    const data = new Uint8Array(128)
    const tick = () => {
      const analyser = analyserRef.current
      if (analyser) {
        analyser.getByteFrequencyData(data)
        const bands = [0, 1, 2, 3, 4].map((b) => {
          const start = b * 12
          let sum = 0
          for (let i = start; i < start + 12; i++) sum += data[i]
          return Math.max(0.1, Math.min(1, sum / (12 * 200)))
        })
        setLevels(bands)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, analyserRef])

  return levels
}

function Bars({ levels }: { levels: number[] }) {
  return (
    <div className="flex items-end gap-[3px] h-[16px]">
      {levels.map((level, i) => (
        <div key={i} className="w-[4px] bg-current rounded-t-sm" style={{ height: `${Math.round(level * 100)}%` }} />
      ))}
    </div>
  )
}

// Claude speaking: bars follow the TTS playback
export function LcdBars() {
  const { status, analyserRef } = useAgentCall()
  const levels = useLevelBars(analyserRef, status === "speaking")
  return <Bars levels={levels} />
}

// You speaking: bars follow the microphone, so you can see the phone hears you
export function MicBars() {
  const { status, micAnalyserRef } = useAgentCall()
  const levels = useLevelBars(micAnalyserRef, status === "recording" || status === "listening")
  return <Bars levels={levels} />
}
