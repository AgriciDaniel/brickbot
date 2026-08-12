"use client"

import { useEffect, useRef, useState } from "react"
import { useAgentCall, type CallStatus } from "@/contexts/agent-call-context"
import { PixelAvatar, LcdBars, MicBars } from "@/components/pixel-avatar"
import { SnakeGame, type SnakeHandle } from "@/components/snake-game"
import { getSettings, setSetting, VOICES, type PhoneSettings } from "@/lib/phone-settings"
import { playKeyTone } from "@/lib/dtmf"
import { Phone, PhoneOff, ChevronDown, ChevronUp } from "lucide-react"
import { useClickWheelSound } from "@/hooks/use-click-wheel-sound"

const STATUS_LABEL: Record<CallStatus, string> = {
  offline: "BRIDGE OFFLINE",
  idle: "PRESS ─ TO TALK",
  listening: "LISTENING...",
  recording: "● REC",
  transcribing: "TRANSCRIBING...",
  thinking: "THINKING...",
  speaking: "SPEAKING",
}

type View = "call" | "menu" | "log" | "settings" | "snake"

const MENU_ITEMS: { label: string; view: View }[] = [
  { label: "Transcript", view: "log" },
  { label: "Snake II", view: "snake" },
  { label: "Settings", view: "settings" },
]

function formatCallTime(startedAt: number | null, now: number) {
  if (!startedAt) return ""
  const s = Math.max(0, Math.floor((now - startedAt) / 1000))
  const mm = String(Math.floor(s / 60)).padStart(2, "0")
  const ss = String(s % 60).padStart(2, "0")
  return `${mm}:${ss}`
}

// Dark navy keypad key, arched row placement like the real 3310
const KEY_TILT = ["rotate-[-8deg] translate-y-[3px]", "-translate-y-[2px]", "rotate-[8deg] translate-y-[3px]"]

export function Nokia3310({ isActive = true, deviceName = "Nokia 3310" }: { isActive?: boolean; deviceName?: string }) {
  const { status, transcript, liveCall, callStartedAt, suggestions, chooseSuggestion, toggleTalk, toggleLive } =
    useAgentCall()
  const { playClick, setEnabled: setClicksEnabled } = useClickWheelSound()

  const [view, setView] = useState<View>("call")
  const [menuIndex, setMenuIndex] = useState(0)
  const [settingsIndex, setSettingsIndex] = useState(0)
  const [settings, setSettingsState] = useState<PhoneSettings>(() => getSettings())
  const [logOffset, setLogOffset] = useState(0)
  const [clock, setClock] = useState("")
  const [now, setNow] = useState(() => Date.now())
  const snakeRef = useRef<SnakeHandle>(null)

  useEffect(() => {
    setClicksEnabled(getSettings().clicks)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const update = () =>
      setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }))
    update()
    const interval = setInterval(update, 10000)
    return () => clearInterval(interval)
  }, [])

  // Tick the call timer only while on a live call
  useEffect(() => {
    if (!liveCall) return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [liveCall])

  // Snap to the newest entry whenever a new line arrives
  useEffect(() => {
    setLogOffset(0)
  }, [transcript.length])

  const cycleSetting = () => {
    if (settingsIndex === 0) {
      const next = setSetting("clicks", !settings.clicks)
      setClicksEnabled(next.clicks)
      setSettingsState(next)
    } else if (settingsIndex === 1) {
      const next = setSetting("tones", !settings.tones)
      setSettingsState(next)
      if (next.tones) playKeyTone("5") // preview beep
    } else if (settingsIndex === 2) {
      const order: PhoneSettings["micSens"][] = ["low", "normal", "high"]
      const next = setSetting("micSens", order[(order.indexOf(settings.micSens) + 1) % order.length])
      setSettingsState(next)
    } else {
      const idx = VOICES.findIndex((v) => v.id === settings.voice)
      const next = setSetting("voice", VOICES[(idx + 1) % VOICES.length].id)
      setSettingsState(next)
    }
  }

  const handleUpPress = () => {
    playClick()
    if (view === "call") setView("menu")
    else if (view === "menu") setMenuIndex((i) => (i + MENU_ITEMS.length - 1) % MENU_ITEMS.length)
    else if (view === "settings") setSettingsIndex((i) => (i + 3) % 4)
    else if (view === "log") setLogOffset((prev) => Math.min(Math.max(0, transcript.length - 1), prev + 1))
    else if (view === "snake") snakeRef.current?.steer("up")
  }

  const handleDownPress = () => {
    playClick()
    if (view === "call") setView("menu")
    else if (view === "menu") setMenuIndex((i) => (i + 1) % MENU_ITEMS.length)
    else if (view === "settings") setSettingsIndex((i) => (i + 1) % 4)
    else if (view === "log") setLogOffset((prev) => Math.max(0, prev - 1))
    else if (view === "snake") snakeRef.current?.steer("down")
  }

  const handleSelectPress = () => {
    playClick()
    if (view === "call") toggleTalk()
    else if (view === "menu") setView(MENU_ITEMS[menuIndex].view)
    else if (view === "settings") cycleSetting()
    else if (view === "log") setView("menu")
    else if (view === "snake") snakeRef.current?.pressCenter()
  }

  const handleCallPress = () => {
    playClick()
    if (view !== "call") {
      setView("call")
      return
    }
    toggleLive()
  }

  const handleKeypad = (key: string) => {
    playKeyTone(key)
    if (view === "snake") {
      if (key === "2") snakeRef.current?.steer("up")
      else if (key === "4") snakeRef.current?.steer("left")
      else if (key === "6") snakeRef.current?.steer("right")
      else if (key === "8") snakeRef.current?.steer("down")
      else if (key === "5") snakeRef.current?.pressCenter()
      return
    }
    if (view === "call") {
      // IVR: agent offers 3 actions, keys 1-3 pick one
      if (key === "1") chooseSuggestion(0)
      else if (key === "2") chooseSuggestion(1)
      else if (key === "3") chooseSuggestion(2)
      return
    }
    if (key === "2") handleUpPress()
    else if (key === "8") handleDownPress()
    else if (key === "5") handleSelectPress()
  }

  const LOG_PAGE = 4
  const visibleLog = (() => {
    const end = transcript.length - logOffset
    return transcript.slice(Math.max(0, end - LOG_PAGE), end)
  })()

  const lastLine = transcript.length > 0 ? transcript[transcript.length - 1] : null

  const settingRows = [
    { label: "Key clicks", value: settings.clicks ? "On" : "Off" },
    { label: "Key tones", value: settings.tones ? "On" : "Off" },
    { label: "Mic sens.", value: settings.micSens.charAt(0).toUpperCase() + settings.micSens.slice(1) },
    { label: "Voice", value: VOICES.find((v) => v.id === settings.voice)?.label || "?" },
  ]

  const renderLcdContent = () => {
    if (view === "menu") {
      return (
        <div className="flex-1 flex flex-col">
          <div className="text-center text-[10px] font-bold border-b border-current/40 pb-[2px] mb-1">MENU</div>
          {MENU_ITEMS.map((item, i) => (
            <div
              key={item.view}
              className={`px-2 py-1 text-[11px] font-bold leading-tight ${i === menuIndex ? "bg-[#1a3520] text-[#a4b494]" : ""}`}
            >
              {item.label}
            </div>
          ))}
          <div className="mt-auto text-center text-[8px] opacity-60">─ select</div>
        </div>
      )
    }

    if (view === "settings") {
      return (
        <div className="flex-1 flex flex-col">
          <div className="text-center text-[10px] font-bold border-b border-current/40 pb-[2px] mb-1">SETTINGS</div>
          {settingRows.map((row, i) => (
            <div
              key={row.label}
              className={`px-2 py-1 text-[10px] font-bold leading-tight flex justify-between ${
                i === settingsIndex ? "bg-[#1a3520] text-[#a4b494]" : ""
              }`}
            >
              <span>{row.label}</span>
              <span>{row.value}</span>
            </div>
          ))}
          <div className="mt-auto text-center text-[8px] opacity-60">─ change</div>
        </div>
      )
    }

    if (view === "snake") {
      return <SnakeGame ref={snakeRef} />
    }

    if (view === "log") {
      return (
        <div className="flex-1 flex flex-col gap-[2px] overflow-hidden">
          <div className="text-center text-[10px] font-bold border-b border-current/40 pb-[2px]">TRANSCRIPT</div>
          {visibleLog.length === 0 ? (
            <div className="text-[10px] opacity-70 px-1 pt-2">No messages yet</div>
          ) : (
            visibleLog.map((line, i) => (
              <div key={i} className="text-[9px] leading-tight px-1">
                <span className="font-bold">{line.role === "you" ? "> " : line.role === "claude" ? "C: " : "! "}</span>
                <span className="line-clamp-2">{line.text}</span>
              </div>
            ))
          )}
        </div>
      )
    }

    // Home / call view
    return (
      <div className="flex-1 flex flex-col items-center justify-between pb-0.5">
        <div className={status === "offline" ? "opacity-30 mt-1" : "mt-1"}>
          <PixelAvatar />
        </div>

        {suggestions.length === 0 && (
          <div className="h-[14px] flex items-center justify-center">
            {status === "speaking" ? (
              <LcdBars />
            ) : status === "recording" || status === "listening" ? (
              <MicBars />
            ) : null}
          </div>
        )}

        <div className="text-[9px] font-bold tracking-wide">
          {suggestions.length > 0 && (status === "idle" || status === "listening")
            ? "CHOOSE 1·2·3 OR TALK"
            : liveCall
              ? `CALL ${formatCallTime(callStartedAt, now)} · ${STATUS_LABEL[status]}`
              : STATUS_LABEL[status]}
        </div>

        {suggestions.length > 0 ? (
          <div className="w-full px-1 h-[32px] overflow-hidden">
            {suggestions.map((s, i) => (
              <div key={i} className="text-[8px] leading-[10px] truncate">
                <span className="font-bold">{i + 1}</span> {s}
              </div>
            ))}
          </div>
        ) : (
          <div className="w-full text-[9px] leading-tight text-center opacity-80 h-[20px] overflow-hidden px-1">
            {lastLine ? (
              <span className="line-clamp-2">
                {lastLine.role === "you" ? "> " : lastLine.role === "claude" ? "C: " : ""}
                {lastLine.text}
              </span>
            ) : (
              <span className="opacity-60">CLAUDE on the line</span>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="relative z-10 flex items-center justify-center">
      {/* Soft drop shadow behind the phone */}
      <div className="absolute w-[250px] h-[530px] bg-black/40 rounded-[80px] blur-2xl"></div>

      {/* ── Nokia 3310 body: dark navy, no full-body bezel ── */}
      <div className="relative w-[240px] h-[520px] bg-gradient-to-br from-[#39466b] via-[#232e4c] to-[#151d33] rounded-t-[68px] rounded-b-[54px] shadow-[0_22px_50px_rgba(0,0,0,0.75)] border border-[#0d1322]">
        {/* Body sheen */}
        <div className="absolute inset-0 rounded-t-[68px] rounded-b-[54px] bg-gradient-to-b from-white/12 via-transparent to-black/25 pointer-events-none"></div>
        <div className="absolute top-[40px] bottom-[40px] left-0 w-[26px] bg-gradient-to-r from-white/8 to-transparent rounded-l-[54px] pointer-events-none"></div>
        <div className="absolute top-[40px] bottom-[40px] right-0 w-[26px] bg-gradient-to-l from-black/25 to-transparent rounded-r-[54px] pointer-events-none"></div>

        {/* Speaker slots: stacked dashes like the original earpiece */}
        <div className="absolute top-[14px] left-1/2 -translate-x-1/2 flex flex-col items-center gap-[3px]">
          {[10, 14, 14, 10].map((w, i) => (
            <div
              key={i}
              style={{ width: w }}
              className="h-[2.5px] bg-[#0a0f1c] rounded-full shadow-[0_1px_1px_rgba(255,255,255,0.08)]"
            ></div>
          ))}
        </div>

        {/* ── Silver faceplate: wraps the screen and nav keys only ── */}
        <div className="absolute top-[46px] left-1/2 -translate-x-1/2 w-[204px] h-[286px] bg-gradient-to-b from-[#e6eaee] via-[#c9d1d8] to-[#9fa9b4] rounded-t-[48px] rounded-b-[100px] shadow-[0_6px_14px_rgba(0,0,0,0.55),0_1px_0_rgba(255,255,255,0.55)_inset,0_-2px_5px_rgba(0,0,0,0.3)_inset] border border-[#7f8994]">
          {/* NOKIA logo printed on the plate */}
          <div className="absolute top-[8px] left-1/2 -translate-x-1/2 text-[#2a3550] text-[14px] font-extrabold tracking-[0.12em]">
            NOKIA
          </div>

          {/* Screen: dark surround, green LCD */}
          <div className="absolute top-[30px] left-1/2 -translate-x-1/2 w-[180px] h-[158px] bg-gradient-to-br from-[#252f4a] via-[#1a2338] to-[#111827] rounded-[14px] shadow-[0_4px_10px_rgba(0,0,0,0.8)_inset,0_1px_0_rgba(255,255,255,0.25)] p-[6px]">
            {isActive ? (
              <div className="w-full h-full bg-[#a4b494] rounded-[7px] relative overflow-hidden shadow-[0_0_14px_rgba(164,180,148,0.35),0_2px_4px_rgba(0,0,0,0.35)_inset]">
                {/* Glass reflection */}
                <div className="absolute top-0 left-0 right-[45%] h-[55%] bg-gradient-to-br from-white/15 to-transparent rounded-tl-[7px] pointer-events-none"></div>
                {/* LCD pixel grid texture */}
                <div
                  className="absolute inset-0 opacity-[0.08]"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(0,0,0,0.15) 1px, rgba(0,0,0,0.15) 2px), repeating-linear-gradient(90deg, transparent, transparent 1px, rgba(0,0,0,0.15) 1px, rgba(0,0,0,0.15) 2px)",
                  }}
                ></div>

                {/* Screen content */}
                <div className="relative z-10 p-2 h-full flex flex-col text-[#1a3520] font-mono">
                  {/* Status bar */}
                  <div className="flex justify-between items-center text-[9px] mb-1">
                    <div className="flex items-center gap-1.5">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M3 6h18v2H3V6m0 5h18v2H3v-2m0 5h18v2H3v-2z" />
                      </svg>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M16 6v12H4V6h12m1-2H3c-.55 0-1 .45-1 1v14c0 .55.45 1 1 1h14c.55 0 1-.45 1-1V5c0-.55-.45-1-1-1zm3 4h2v8h-2V8z" />
                      </svg>
                    </div>
                    <div className="text-[10px] font-bold">{clock}</div>
                    <div className="flex gap-[1.5px] items-end">
                      <div className="w-[2px] h-[5px] bg-current"></div>
                      <div className={`w-[2px] h-[6px] bg-current ${status === "offline" ? "opacity-20" : ""}`}></div>
                      <div className={`w-[2px] h-[7px] bg-current ${status === "offline" ? "opacity-20" : ""}`}></div>
                      <div className={`w-[2px] h-[8px] bg-current ${status === "offline" ? "opacity-20" : ""}`}></div>
                    </div>
                  </div>

                  {renderLcdContent()}
                </div>
              </div>
            ) : (
              <div className="w-full h-full bg-[#8a9a8a] rounded-[7px] flex items-center justify-center shadow-[0_2px_4px_rgba(0,0,0,0.3)_inset]">
                <div className="text-[#2a3a2a] text-sm font-bold font-mono text-center px-2">Nokia</div>
              </div>
            )}
          </div>

          {/* Nav keys on the plate */}
          <div className="absolute top-[196px] left-0 right-0 h-[86px]">
            {/* Navi key: silver pill with the cyan dash */}
            <button
              onClick={handleSelectPress}
              className="absolute left-1/2 -translate-x-1/2 top-[2px] w-[84px] h-[27px] rounded-full bg-gradient-to-b from-[#fbfdff] via-[#dde3e9] to-[#b3bcc5] shadow-[0_3px_7px_rgba(0,0,0,0.5),0_1px_0_rgba(255,255,255,0.85)_inset,0_-1px_0_rgba(0,0,0,0.25)_inset] active:shadow-[0_2px_4px_rgba(0,0,0,0.55)_inset] active:translate-y-[1px] flex items-center justify-center border border-[#8b95a0] z-10"
              aria-label="Push to talk / select"
            >
              <div
                className={`w-[40px] h-[4px] rounded-full shadow-[0_1px_1px_rgba(0,0,0,0.35)] ${
                  status === "recording"
                    ? "bg-gradient-to-b from-[#f09090] to-[#c22525] animate-pulse"
                    : "bg-gradient-to-b from-[#8fdce8] to-[#35a2b6]"
                }`}
              ></div>
            </button>

            {/* Scroll rocker (left, tilted like the C key) */}
            <div className="absolute left-[24px] top-[32px] w-[58px] h-[29px] rounded-full rotate-[18deg] bg-gradient-to-b from-[#f4f7fa] via-[#d8dee4] to-[#b0bac3] shadow-[0_3px_6px_rgba(0,0,0,0.5),0_1px_0_rgba(255,255,255,0.7)_inset,0_-1px_0_rgba(0,0,0,0.2)_inset] border border-[#8b95a0] flex overflow-hidden text-[#2a3550]">
              <button
                onClick={handleUpPress}
                className="w-1/2 h-full flex items-center justify-center active:bg-black/10"
                aria-label="Up"
              >
                <ChevronUp size={14} strokeWidth={3} className="rotate-[-18deg]" />
              </button>
              <div className="w-[1px] h-[55%] self-center bg-[#8b95a0]/60"></div>
              <button
                onClick={handleDownPress}
                className="w-1/2 h-full flex items-center justify-center active:bg-black/10"
                aria-label="Down"
              >
                <ChevronDown size={14} strokeWidth={3} className="rotate-[-18deg]" />
              </button>
            </div>

            {/* Green call key (right, tilted) */}
            <button
              onClick={handleCallPress}
              className={`absolute right-[24px] top-[32px] w-[58px] h-[29px] rounded-full rotate-[-18deg] shadow-[0_3px_6px_rgba(0,0,0,0.5),0_1px_0_rgba(255,255,255,0.7)_inset,0_-1px_0_rgba(0,0,0,0.2)_inset] active:shadow-[0_2px_4px_rgba(0,0,0,0.55)_inset] active:translate-y-[1px] flex items-center justify-center border border-[#8b95a0] bg-gradient-to-b from-[#f4f7fa] via-[#d8dee4] to-[#b0bac3] ${
                liveCall ? "text-[#b02020]" : "text-[#1d7a2c]"
              }`}
              aria-label={liveCall ? "End call" : "Start live call"}
            >
              <span className="rotate-[18deg]">
                {liveCall ? <PhoneOff size={15} strokeWidth={2.6} /> : <Phone size={15} strokeWidth={2.6} />}
              </span>
            </button>
          </div>
        </div>

        {/* ── Keypad: dark navy oval keys, arched rows, white legends ── */}
        <div className="absolute bottom-[18px] left-1/2 -translate-x-1/2 w-[186px]">
          <div className="grid grid-cols-3 gap-x-[10px] gap-y-[9px]">
            {[
              ["1", "oo"],
              ["2", "abc"],
              ["3", "def"],
              ["4", "ghi"],
              ["5", "jkl"],
              ["6", "mno"],
              ["7", "pqrs"],
              ["8", "tuv"],
              ["9", "wxyz"],
              ["*", "+"],
              ["0", "␣"],
              ["#", "⇧"],
            ].map(([num, letters], i) => (
              <button
                key={i}
                onClick={() => handleKeypad(num)}
                className={`h-[30px] rounded-full bg-gradient-to-b from-[#31405f] via-[#232e4a] to-[#16203a] shadow-[0_3px_5px_rgba(0,0,0,0.6),0_1px_0_rgba(255,255,255,0.14)_inset,0_-1px_0_rgba(0,0,0,0.4)_inset] active:shadow-[0_2px_3px_rgba(0,0,0,0.6)_inset] active:translate-y-[1px] flex items-center justify-center border border-[#3d4d70] ${KEY_TILT[i % 3]}`}
              >
                <span className="flex items-center leading-none">
                  <span className="text-[14px] text-[#eef2f8] font-bold [text-shadow:0_1px_1px_rgba(0,0,0,0.6)]">
                    {num}
                  </span>
                  {letters && (
                    <span className="text-[7px] text-[#c3cddd] font-semibold ml-[2px] mt-[5px] tracking-tight">
                      {letters}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Mic hole */}
        <div className="absolute bottom-[7px] left-1/2 -translate-x-1/2 w-[4px] h-[4px] rounded-full bg-[#0a0f1c]"></div>
      </div>
    </div>
  )
}
