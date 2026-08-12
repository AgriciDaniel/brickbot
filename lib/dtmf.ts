// Real DTMF: the dual-tone frequencies actual telephones dial with.
// Each key gets its own pair, synthesized on the fly — no audio assets.

import { getSettings } from "./phone-settings"

const FREQS: Record<string, [number, number]> = {
  "1": [697, 1209],
  "2": [697, 1336],
  "3": [697, 1477],
  "4": [770, 1209],
  "5": [770, 1336],
  "6": [770, 1477],
  "7": [852, 1209],
  "8": [852, 1336],
  "9": [852, 1477],
  "*": [941, 1209],
  "0": [941, 1336],
  "#": [941, 1477],
}

let ctx: AudioContext | null = null

export function playKeyTone(key: string) {
  if (typeof window === "undefined") return
  if (!getSettings().tones) return
  const pair = FREQS[key]
  if (!pair) return

  if (!ctx) {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    if (!Ctx) return
    ctx = new Ctx()
  }
  ctx.resume()

  const t = ctx.currentTime
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(0.1, t + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09)
  gain.connect(ctx.destination)

  for (const freq of pair) {
    const osc = ctx.createOscillator()
    osc.type = "sine"
    osc.frequency.value = freq
    osc.connect(gain)
    osc.start(t)
    osc.stop(t + 0.1)
  }
}
