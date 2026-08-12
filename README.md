# IAmNokia 📞

**A Nokia 3310 that takes live voice calls with Claude. No API keys.**

```
┌──────────────────────────────────────┐
│ ≡ ▭            16:52            ▁▃▅▇ │
│                                      │
│              ▄▄▄▄▄▄▄▄                │
│            ▄▀        ▀▄              │
│            █  ██  ██  █              │
│            █          █              │
│            █   ▄▄▄▄   █    CLAUDE    │
│            ▀▄        ▄▀   ON  THE    │
│              ▀▀▀▀▀▀▀▀       LINE     │
│                                      │
│         CALL 00:42 · SPEAKING        │
│      1 check my repo                 │
│      2 read the news                 │
│      3 play snake                    │
└──────────────────────────────────────┘
```

Press the green key. Talk. It hears you (local Whisper on your GPU), thinks
(your own persistent Claude Code CLI session, full tool access), and talks
back (edge-tts) while a pixel avatar lip-syncs on the monochrome LCD. Every
answer ends with three IVR options — press 1, 2, or 3 like it's 1999.

## How it works

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

## Quickstart

Requirements: Node 18+, pnpm, Python 3.10+ with `faster-whisper` + `edge-tts`,
ffmpeg, an NVIDIA GPU (CUDA 12), and an authenticated
[Claude Code CLI](https://claude.ai/code).

```bash
pnpm install
pnpm dev        # phone    → http://localhost:3000
pnpm bridge     # bridge   → ws://localhost:3010

# snappier calls on a faster model:
CLAUDE_MODEL=claude-sonnet-5 pnpm bridge
```

The LCD signal bars tell the truth: full = bridge connected.

## The phone

| Key | Does |
|---|---|
| **Green key** | start / end a hands-free live call (voice-activity detection: talk, pause, it answers, repeat) |
| **Navi key** (cyan dash) | push-to-talk — dash turns red while recording; press again to send; interrupts Claude mid-sentence |
| **Rocker ▲▼** | menu: Transcript · Snake II · Settings |
| **Keypad 1·2·3** | pick one of the three actions Claude offers after every reply |
| **Keypad 2·4·6·8** | steer the snake |

Settings (persisted): key clicks, mic sensitivity, Claude's voice
(Ava / Andrew / Emma / Sonia).

## Docs

- **[HANDOFF.md](HANDOFF.md)** — full integration reference: file inventory,
  WebSocket protocol, IVR contract, state machine, tuning, gotchas.
- **[PRINCIPLE.md](PRINCIPLE.md)** — the one design law:
  *if it wouldn't exist on a 1999 Nokia, it doesn't belong on this phone.*

## Before you expose anything

The bridge gives the phone a Claude session with **full tool access** and
binds all interfaces by default. Keep it on localhost
(`server.listen(PORT, '127.0.0.1')`) unless you very deliberately want your
LAN talking to your terminal.

## Credits

- Phone chassis derived from [Played](https://github.com/sidhyatikku/music-player-skin)
  by Sidhya Tikku (GPL-3.0) — the Nokia started life as a music player skin.
- Voice pipeline adapted from [claude-avatar](https://github.com/AgricIDaniel/claude-avatar)
  by Agrici Daniel.
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper) ·
  [edge-tts](https://github.com/rany2/edge-tts) · Snake II © our collective memory.

## License

GPL-3.0 — see [LICENSE](LICENSE). This project derives from GPL-3.0 code and
stays free the same way.
