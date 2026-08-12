# Nokia Voice — Integration Handoff

A Nokia 3310 rendered in React that takes live voice calls with Claude.
No API keys: speech goes through local Whisper (GPU), a persistent Claude
Code CLI session, and edge-tts, glued by one WebSocket bridge.

```
Browser (Next.js phone UI)
  │  mic (MediaRecorder, webm)          TTS mp3 + word timings
  ▼                                     ▲
WebSocket  ws://localhost:3010          │
  ▼                                     │
bridge/server.cjs ──► ffmpeg ──► faster-whisper (CUDA, persistent)
        │                                 
        ├──► claude CLI (persistent stream-json session, full tools)
        └──► bridge/tts.py (edge-tts, word boundaries)
```

## 1. What to copy into your app

Frontend (React 18 + Tailwind v4 + lucide-react):

| File | Role |
|---|---|
| `components/nokia-3310.tsx` | The phone: chassis, LCD views (call/menu/log/settings/snake), key routing |
| `components/pixel-avatar.tsx` | Pixel face w/ lip-sync + `LcdBars` (TTS levels) + `MicBars` (mic levels) |
| `components/snake-game.tsx` | Snake II (wrap walls, 9 pts/feed, speeds up) |
| `components/nokia-stage.tsx` | Scales phone to viewport, mounts provider |
| `contexts/agent-call-context.tsx` | All call logic: WS client, PTT, live-call VAD, TTS playback, IVR parsing |
| `hooks/use-click-wheel-sound.tsx` | Key click sounds (provider goes in your root layout) |
| `lib/phone-settings.ts` | localStorage settings: clicks, mic sensitivity, voice |

Backend (Node 18+, python3):

| File | Role |
|---|---|
| `bridge/server.cjs` | WS server :3010, spawns whisper + claude, runs TTS |
| `bridge/transcribe_server.py` | Persistent faster-whisper `large-v3-turbo` on CUDA |
| `bridge/tts.py` | edge-tts with word-level timings |

Mount: wrap your tree in `ClickWheelSoundProvider` (layout) and render
`<NokiaStage />` (or `<AgentCallProvider><Nokia3310 /></AgentCallProvider>`
if you handle sizing yourself).

## 2. Requirements

- Node 18+, pnpm; Python 3.10+ with `faster-whisper` and `edge-tts`; ffmpeg
- Claude Code CLI installed and authenticated (native binary or cli.js — auto-detected)
- NVIDIA GPU with CUDA 12 libs for whisper. This machine reuses the CapForge
  runtime libs via `LD_LIBRARY_PATH` (see `cudaEnv()` in `server.cjs`). On
  another machine: `pip install nvidia-cublas-cu12 nvidia-cudnn-cu12` and
  point `NVIDIA_LIB_ROOT` at its `site-packages/nvidia`, or set
  `device="cpu", compute_type="int8"` in `transcribe_server.py`
- Browser with mic. `getUserMedia` needs a secure context: localhost is fine,
  a remote deployment needs HTTPS (and `wss://` for the bridge)

## 3. Run

```bash
pnpm install
pnpm dev                                # phone on http://localhost:3000
pnpm bridge                             # bridge on ws://localhost:3010
CLAUDE_MODEL=claude-sonnet-5 pnpm bridge  # faster/cheaper voice turns
```

Signal bars on the LCD are truthful: full = bridge connected, dimmed = offline
(the client retries every 2 s).

## 4. WebSocket protocol

Client → bridge (JSON, one object per message):

| Message | Fields |
|---|---|
| voice turn | `{id, type:"transcribe", audio:<base64 webm>, voice?}` |
| text turn | `{id, type:"chat", text, voice?}` |

`voice` is an edge-tts voice id (see `lib/phone-settings.ts` VOICES).

Bridge → client (all carry the request `id`):

| Event | Meaning |
|---|---|
| `transcribing` | whisper started |
| `transcript {text}` | what it heard (empty = nothing usable) |
| `stream {content}` | Claude partial text |
| `tool {tool, detail}` / `tool_result {content}` | Claude using tools |
| `model {model}` / `usage {tokens, cost, duration}` | session telemetry |
| `generating_voice` | TTS started |
| `result {content, tts?}` | final text; `tts = {audio: b64 mp3, words[], wtimes[], wdurations[]}` (ms) |
| `error {message}` | anything that broke |

The `wtimes`/`wdurations` arrays drive the avatar mouth (see
`pixel-avatar.tsx` rAF loop) — reuse them for any lip-sync UI.

## 5. The IVR contract (keys 1·2·3)

The bridge system prompt forces every reply to end with:

```
>>> 1) short action | 2) short action | 3) action
```

- `server.cjs` strips this line from the TTS audio (never spoken)
- the context parses it into `suggestions[]` and strips it from the transcript
- the LCD lists the three options; keypad 1/2/3 sends the option as a
  `chat` turn; speaking instead clears them

To change the shape (more options, different glyphs), keep prompt + regex in
sync: `SYSTEM_PROMPT` in `server.cjs`, the `>>>` regex in
`agent-call-context.tsx`.

## 6. Controls / state machine

| Key | Home (call) | Menu/Settings/Log | Snake |
|---|---|---|---|
| Navi (center) | push-to-talk; press again to send; interrupts Claude | select / cycle value / back | pause · restart |
| Green key | start/end hands-free live call | back to home | back to home |
| Rocker ▲▼ | open menu | scroll | steer up/down |
| Keypad 1–3 | pick IVR suggestion | — | — |
| Keypad 2/4/6/8 | — | 2/8 scroll, 5 select | steer |

Statuses: `offline → idle → recording → transcribing → thinking → speaking`,
plus `listening` (live call armed). Live call loop: VAD start (3×50 ms frames
over threshold) → utterance ends after 1.2 s silence → send → answer plays →
listening resumes after 350 ms. Tunables at top of `agent-call-context.tsx`;
mic threshold comes from Settings (0.06 / 0.04 / 0.025 RMS).

## 7. Gotchas (learned the hard way)

- **Bind the bridge to loopback before shipping.** `server.listen(PORT)`
  binds all interfaces; this session's Claude has full tool access. Change to
  `server.listen(PORT, '127.0.0.1')` unless you intend LAN access.
- **One turn at a time.** The bridge holds a single persistent Claude session
  with one pending resolver — don't fire concurrent requests.
- **Port choice**: 3001 was taken by a podman rootlessport on this machine;
  bridge lives on 3010. Grep `BRIDGE_URL` + `PORT` to move it.
- **Audio unlock**: the first key press creates/resumes the AudioContext;
  playback later is allowed because the page has user activation.
- **Echo**: the phone never listens while speaking and waits 350 ms after
  playback, but speakers near the mic can still self-trigger — headphones or
  lower mic sensitivity fix it.
- **Dev-mode HMR** closes the WS on every code edit (stale-socket races are
  guarded, but in-flight calls end). For demos: don't edit, or `next build
  && next start`.
- **Latency/cost**: with the default session model (Fable 5 + full context)
  a turn is 15–30 s and ~$0.6–0.9. `CLAUDE_MODEL=claude-sonnet-5` (or haiku)
  makes it call-snappy.
- **Whisper VRAM**: each bridge instance holds ~4 GB. Kill stale
  `transcribe_server.py` processes from other projects before running.

## 8. Extension points

- **Pin the agent to a project/session**: the Claude spawn in `server.cjs`
  uses `cwd: HOME` and a fresh session — set `cwd` to a repo, or add
  `--resume <session-id>` to join an existing conversation.
- **Voices**: add any edge-tts voice id to `VOICES` in `phone-settings.ts`.
- **New LCD apps**: add a `View` string + a renderer in `nokia-3310.tsx`
  `renderLcdContent()`, and a menu row in `MENU_ITEMS`. Snake shows the
  pattern for keypad-driven views.
- **Design law**: `PRINCIPLE.md` — if it wouldn't exist on a 1999 Nokia, it
  doesn't belong on this phone.
