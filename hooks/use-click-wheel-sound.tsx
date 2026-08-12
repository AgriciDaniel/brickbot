"use client"

import { createContext, useContext, useRef, useState, useCallback, useEffect, type ReactNode } from "react"

interface ClickWheelSoundContextType {
  playClick: (velocity?: number) => void
  setEnabled: (enabled: boolean) => void
  enabled: boolean
}

const ClickWheelSoundContext = createContext<ClickWheelSoundContextType | null>(null)

export function ClickWheelSoundProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(true)
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioBufferRef = useRef<AudioBuffer | null>(null)
  const lastPlayTimeRef = useRef<number>(0)
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const velocityHistoryRef = useRef<number[]>([])
  const isUnlockedRef = useRef(false)

  useEffect(() => {
    const initAudio = async () => {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
        if (!AudioContextClass) {
          console.warn("[v0] Web Audio API not supported")
          return
        }

        audioContextRef.current = new AudioContextClass()
        console.log("[v0] AudioContext created, state:", audioContextRef.current.state)

        const response = await fetch(
          "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/sound-2-3MBFmUiLFA8hzXiIffCRSUl1Oom5sL.mov",
        )
        const arrayBuffer = await response.arrayBuffer()
        audioBufferRef.current = await audioContextRef.current.decodeAudioData(arrayBuffer)

        console.log("[v0] Click sound loaded successfully")
      } catch (error) {
        console.error("[v0] Failed to load click sound:", error)
      }
    }

    initAudio()

    const unlockAudio = async () => {
      if (audioContextRef.current && audioContextRef.current.state === "suspended" && !isUnlockedRef.current) {
        console.log("[v0] Attempting to unlock audio context for iOS...")
        try {
          await audioContextRef.current.resume()
          isUnlockedRef.current = true
          console.log("[v0] Audio context unlocked successfully, state:", audioContextRef.current.state)
        } catch (error) {
          console.error("[v0] Failed to unlock audio context:", error)
        }
      }
    }

    const events = ["touchstart", "touchend", "mousedown", "keydown"]
    events.forEach((event) => {
      document.addEventListener(event, unlockAudio, { once: true })
    })

    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close()
      }
      events.forEach((event) => {
        document.removeEventListener(event, unlockAudio)
      })
    }
  }, [])

  const playClick = useCallback(
    async (velocity = 1) => {
      if (!enabled || !audioContextRef.current || !audioBufferRef.current) {
        return
      }

      if (audioContextRef.current.state === "suspended") {
        try {
          await audioContextRef.current.resume()
          console.log("[v0] Audio context resumed")
        } catch (error) {
          console.error("[v0] Failed to resume audio context:", error)
          return
        }
      }

      const now = performance.now()

      velocityHistoryRef.current.push(velocity)
      if (velocityHistoryRef.current.length > 5) {
        velocityHistoryRef.current.shift()
      }

      const avgVelocity = velocityHistoryRef.current.reduce((sum, v) => sum + v, 0) / velocityHistoryRef.current.length

      const debounceTime = Math.max(25, 120 - avgVelocity * 95)

      if (now - lastPlayTimeRef.current < debounceTime) {
        return
      }

      if (currentSourceRef.current) {
        try {
          currentSourceRef.current.stop()
        } catch (e) {}
      }

      try {
        const source = audioContextRef.current.createBufferSource()
        source.buffer = audioBufferRef.current

        const gainNode = audioContextRef.current.createGain()

        const baseVolume = 0.6
        const volumeAttenuation = Math.exp(-avgVelocity / 0.4)
        const finalVolume = baseVolume * volumeAttenuation

        gainNode.gain.value = Math.max(0.2, Math.min(1, finalVolume))

        source.connect(gainNode)
        gainNode.connect(audioContextRef.current.destination)

        source.start(0)
        currentSourceRef.current = source

        source.onended = () => {
          if (currentSourceRef.current === source) {
            currentSourceRef.current = null
          }
        }

        lastPlayTimeRef.current = now
      } catch (error) {
        console.error("[v0] Error playing click sound:", error)
      }
    },
    [enabled],
  )

  return (
    <ClickWheelSoundContext.Provider value={{ playClick, setEnabled, enabled }}>
      {children}
    </ClickWheelSoundContext.Provider>
  )
}

export function useClickWheelSound() {
  const context = useContext(ClickWheelSoundContext)
  if (!context) {
    throw new Error("useClickWheelSound must be used within ClickWheelSoundProvider")
  }
  return context
}
