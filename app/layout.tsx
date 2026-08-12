import type React from "react"
import type { Metadata } from "next"
import "./globals.css"
import { ClickWheelSoundProvider } from "@/hooks/use-click-wheel-sound"

export const metadata: Metadata = {
  title: "brickbot",
  description: "A Nokia 3310 that takes live voice calls with Claude. No API keys.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="font-sans">
        <ClickWheelSoundProvider>{children}</ClickWheelSoundProvider>
      </body>
    </html>
  )
}
