// Persisted phone settings, Nokia-simple: three knobs, localStorage, cached reads.

export interface PhoneSettings {
  clicks: boolean
  tones: boolean
  micSens: "low" | "normal" | "high"
  voice: string
}

const KEY = "nokia-phone-settings"

const DEFAULTS: PhoneSettings = {
  clicks: true,
  tones: true,
  micSens: "normal",
  voice: "en-US-AvaMultilingualNeural",
}

// Higher sensitivity = lower RMS threshold
export const MIC_SENS_THRESHOLD: Record<PhoneSettings["micSens"], number> = {
  low: 0.06,
  normal: 0.04,
  high: 0.025,
}

export const VOICES: { id: string; label: string }[] = [
  { id: "en-US-AvaMultilingualNeural", label: "Ava" },
  { id: "en-US-AndrewMultilingualNeural", label: "Andrew" },
  { id: "en-US-EmmaMultilingualNeural", label: "Emma" },
  { id: "en-GB-SoniaNeural", label: "Sonia" },
]

let cache: PhoneSettings | null = null

export function getSettings(): PhoneSettings {
  if (typeof window === "undefined") return DEFAULTS
  if (cache) return cache
  try {
    const raw = window.localStorage.getItem(KEY)
    cache = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache
}

export function setSetting<K extends keyof PhoneSettings>(key: K, value: PhoneSettings[K]): PhoneSettings {
  const next = { ...getSettings(), [key]: value }
  cache = next
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {}
  return next
}
