"use client"

import { useState, useEffect } from "react"
import { Nokia3310 } from "./nokia-3310"
import { AgentCallProvider } from "@/contexts/agent-call-context"

// The Nokia renders at a fixed 240x520 (plus glow), so scale it to fit the viewport.
const PHONE_WIDTH = 260
const PHONE_HEIGHT = 560

export function NokiaStage() {
  const [scale, setScale] = useState<number | null>(null)

  useEffect(() => {
    const computeScale = () => {
      const widthScale = (window.innerWidth * 0.9) / PHONE_WIDTH
      const heightScale = (window.innerHeight * 0.92) / PHONE_HEIGHT
      setScale(Math.min(widthScale, heightScale))
    }
    computeScale()
    window.addEventListener("resize", computeScale)
    return () => window.removeEventListener("resize", computeScale)
  }, [])

  return (
    <AgentCallProvider>
      <div className="relative w-full h-screen flex items-center justify-center overflow-hidden">
        {scale !== null && (
          <div style={{ transform: `scale(${scale})`, transformOrigin: "center center" }}>
            <Nokia3310 isActive deviceName="Nokia 3310" />
          </div>
        )}
      </div>
    </AgentCallProvider>
  )
}
