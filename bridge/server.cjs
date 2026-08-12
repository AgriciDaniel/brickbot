const { WebSocketServer } = require('ws');
const { spawn, execFileSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const server = http.createServer();
const wss = new WebSocketServer({ server, perMessageDeflate: false, maxPayload: 10 * 1024 * 1024 });
const PORT = 3010;

// Auto-detect Claude Code CLI. Modern installs ship a native binary, older
// ones a cli.js that must be run through node.
const CLAUDE_CMD = (() => {
  try {
    const which = execFileSync('which', ['claude'], { encoding: 'utf-8' }).trim();
    const resolved = fs.realpathSync(which);
    if (resolved.endsWith('.js')) return { cmd: process.execPath, baseArgs: [resolved] };
    return { cmd: resolved, baseArgs: [] };
  } catch {
    return { cmd: 'claude', baseArgs: [] };
  }
})();
const TTS_PY = path.join(__dirname, 'tts.py');
const WHISPER_SERVER_PY = path.join(__dirname, 'transcribe_server.py');

const SYSTEM_PROMPT = 'You are Claude, taking a voice call on a retro Nokia phone. Keep responses conversational and SHORT: 1-2 punchy sentences, dark and to the point, never long phrases. Speak naturally as on the phone. No markdown, no code blocks, no bullets, no asterisks. After your spoken reply, ALWAYS end with one final line in EXACTLY this format: >>> 1) action | 2) action | 3) action — three follow-up actions the caller might want next, each under 5 words, always relevant to the subject. Never read that line aloud, never explain it, never number things in your spoken text.';

process.on('uncaughtException', (err) => {
  console.error('Uncaught:', err.message);
});

// ═══════════════════════════════════════════════
// Persistent Whisper (model stays in VRAM)
// ═══════════════════════════════════════════════
let whisperProc = null;
let whisperReady = false;
const whisperQueue = [];

// ctranslate2 needs CUDA 12 libs (cublas, cudnn) at runtime. The host python has
// none, but the CapForge runtime ships the full nvidia pip lib set — reuse it.
const NVIDIA_LIB_ROOT = path.join(
  process.env.HOME,
  '.config/CapForge/runtime/python/lib/python3.11/site-packages/nvidia'
);

function cudaEnv() {
  let dirs = [];
  try {
    dirs = fs.readdirSync(NVIDIA_LIB_ROOT)
      .map((d) => path.join(NVIDIA_LIB_ROOT, d, 'lib'))
      .filter((p) => fs.existsSync(p));
  } catch {}
  if (!dirs.length) return process.env;
  const prev = process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : '';
  return { ...process.env, LD_LIBRARY_PATH: dirs.join(':') + prev };
}

function startWhisper() {
  console.log('Starting whisper server...');
  whisperProc = spawn('python3', [WHISPER_SERVER_PY], { stdio: ['pipe', 'pipe', 'pipe'], env: cudaEnv() });

  let buffer = '';
  whisperProc.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (t === 'MODEL_READY') { whisperReady = true; console.log('Whisper model loaded (GPU)'); }
      else if (t === 'LOADING_MODEL') { console.log('Loading whisper into VRAM...'); }
      else if (t.startsWith('TRANSCRIPT:') && whisperQueue.length) { whisperQueue.shift().resolve(t.slice(11)); }
      else if (t.startsWith('ERROR:') && whisperQueue.length) { whisperQueue.shift().reject(new Error(t.slice(6))); }
    }
  });
  whisperProc.stderr.on('data', () => {});
  whisperProc.on('close', () => {
    whisperReady = false;
    whisperProc = null;
    while (whisperQueue.length) whisperQueue.shift().reject(new Error('Whisper died'));
  });
}

function transcribeWithWhisper(wavPath) {
  return new Promise((resolve, reject) => {
    if (!whisperProc || !whisperReady) return reject(new Error('Whisper not ready'));
    whisperQueue.push({ resolve, reject });
    whisperProc.stdin.write(wavPath + '\n');
  });
}

startWhisper();

// ═══════════════════════════════════════════════
// Persistent Interactive Claude Session
// ═══════════════════════════════════════════════
let claudeProc = null;
let claudeReady = false;
let claudeBuffer = '';
let currentResolve = null;
let currentOnEvent = null;
let currentFullText = '';

function startClaude() {
  console.log('Starting persistent Claude session...');
  claudeProc = spawn(CLAUDE_CMD.cmd, [
    ...CLAUDE_CMD.baseArgs,
    ...(process.env.CLAUDE_MODEL ? ['--model', process.env.CLAUDE_MODEL] : []),
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--no-session-persistence',
    '--verbose',
    '--system-prompt', SYSTEM_PROMPT,
    '-p'
  ], {
    cwd: process.env.HOME,
    env: { ...process.env }
  });

  claudeBuffer = '';

  claudeProc.stdout.on('data', (data) => {
    claudeBuffer += data.toString();
    const lines = claudeBuffer.split('\n');
    claudeBuffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        handleClaudeEvent(event);
      } catch (e) {}
    }
  });

  claudeProc.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.log('  [claude stderr]', msg.slice(0, 100));
  });

  claudeProc.on('close', (code) => {
    console.log('Claude session ended (exit ' + code + ')');
    claudeProc = null;
    claudeReady = false;
    if (currentResolve) {
      currentResolve(currentFullText || 'Claude session ended unexpectedly.');
      currentResolve = null;
    }
    // Auto-restart after a delay
    setTimeout(startClaude, 2000);
  });

  // Mark ready after a short delay (hooks will fire)
  claudeReady = true;
}

function handleClaudeEvent(event) {
  if (event.type === 'assistant' && event.message) {
    const content = event.message.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          currentFullText += block.text;
          if (currentOnEvent) currentOnEvent({ type: 'stream', content: block.text });
        }
        if (block.type === 'tool_use') {
          const input = block.input || {};
          const detail = input.url || input.query || input.command
            || input.pattern || input.file_path || input.prompt
            || input.description || '';
          if (currentOnEvent) currentOnEvent({ type: 'tool', tool: block.name, detail: detail.slice(0, 200) });
        }
      }
    }
    // Forward usage/model info
    if (event.message.model && currentOnEvent) {
      currentOnEvent({ type: 'model', model: event.message.model });
    }
  } else if (event.type === 'tool_result' || event.type === 'tool_output') {
    const content = event.content || event.output;
    if (currentOnEvent) {
      if (typeof content === 'string' && content.trim()) {
        const lines = content.trim().split('\n');
        const preview = lines.slice(0, 3).join('\n').slice(0, 300);
        currentOnEvent({ type: 'tool_result', content: preview, lines: lines.length });
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && block.text) {
            const preview = block.text.trim().split('\n').slice(0, 3).join('\n').slice(0, 300);
            currentOnEvent({ type: 'tool_result', content: preview });
          }
        }
      }
    }
  } else if (event.type === 'result' && event.result) {
    currentFullText = event.result;
    // Forward usage stats
    if (currentOnEvent && event.usage) {
      currentOnEvent({
        type: 'usage',
        tokens: (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0),
        cost: event.total_cost_usd,
        duration: event.duration_ms
      });
    }
    if (currentResolve) {
      currentResolve(currentFullText);
      currentResolve = null;
      currentOnEvent = null;
      currentFullText = '';
    }
  } else if (event.type === 'system') {
    // Forward meaningful system events (skip hook noise and task_progress spam)
    const skip = ['hook_started', 'hook_response', 'task_progress'];
    if (currentOnEvent && !skip.includes(event.subtype)) {
      const msg = event.message || event.subtype || '';
      if (msg) currentOnEvent({ type: 'system', content: msg });
    }
  }
}

function sendToClaude(userText, onEvent) {
  return new Promise((resolve, reject) => {
    if (!claudeProc) {
      return reject(new Error('Claude not running'));
    }

    currentResolve = resolve;
    currentOnEvent = onEvent;
    currentFullText = '';

    // Send user message via stream-json input format
    const msg = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: userText }]
      }
    });
    claudeProc.stdin.write(msg + '\n');
  });
}

startClaude();

// ═══════════════════════════════════════════════
// WebSocket Server
// ═══════════════════════════════════════════════
console.log('Claude TalkingHead Bridge');
console.log('─'.repeat(40));

wss.on('connection', (ws) => {
  console.log('Client connected');

  const pingInterval = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.ping();
  }, 15000);

  const safeSend = (data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(typeof data === 'string' ? data : JSON.stringify(data));
    }
  };

  ws.on('message', async (raw, isBinary) => {
    if (isBinary) return;

    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch (e) { safeSend(JSON.stringify({ type: 'error', message: 'Invalid JSON' })); return; }

    const { id, type, text } = msg;

    // ── Audio transcription → Claude → TTS ──
    if (type === 'transcribe') {
      if (!msg.audio) {
        safeSend(JSON.stringify({ id, type: 'error', message: 'No audio data' }));
        return;
      }

      console.log('[#' + id + '] Transcribing...');
      safeSend(JSON.stringify({ id, type: 'transcribing' }));

      try {
        const transcript = await transcribeAudio(msg.audio);
        if (!transcript.trim()) {
          safeSend(JSON.stringify({ id, type: 'transcript', text: '' }));
          return;
        }

        safeSend(JSON.stringify({ id, type: 'transcript', text: transcript }));
        const result = await sendToClaude(transcript, (evt) => {
          safeSend(JSON.stringify({ id, ...evt }));
        });
        await sendResultWithTTS(id, result, safeSend, msg.voice);
      } catch (err) {
        safeSend(JSON.stringify({ id, type: 'error', message: err.message }));
        console.error('[#' + id + '] Error:', err.message);
      }
      return;
    }

    // ── Text chat ──
    if (type === 'chat') {
      console.log('[#' + id + '] User: ' + text.slice(0, 80));

      try {
        const result = await sendToClaude(text, (evt) => {
          safeSend(JSON.stringify({ id, ...evt }));
        });
        await sendResultWithTTS(id, result, safeSend, msg.voice);
      } catch (err) {
        safeSend(JSON.stringify({ id, type: 'error', message: err.message }));
        console.error('[#' + id + '] Error:', err.message);
      }
    }
  });

  ws.on('close', () => {
    clearInterval(pingInterval);
    console.log('Client disconnected');
  });
});

// ═══════════════════════════════════════════════
// Audio helpers
// ═══════════════════════════════════════════════
async function transcribeAudio(base64Audio) {
  const tmpFile = path.join(os.tmpdir(), 'claude-avatar-' + Date.now() + '.webm');
  const wavFile = tmpFile.replace('.webm', '.wav');
  try {
    fs.writeFileSync(tmpFile, Buffer.from(base64Audio, 'base64'));
    execFileSync('ffmpeg', ['-y', '-i', tmpFile, '-ar', '16000', '-ac', '1', '-f', 'wav', wavFile], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return await transcribeWithWhisper(wavFile);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch(e) {}
    try { fs.unlinkSync(wavFile); } catch(e) {}
  }
}

async function sendResultWithTTS(id, text, safeSend, voice) {
  console.log('[#' + id + '] Generating TTS...');
  safeSend(JSON.stringify({ id, type: 'generating_voice' }));

  try {
    // The trailing ">>> 1) ..." options line is for the LCD, not the speaker
    const spoken = String(text).replace(/>>>[\s\S]*$/, '').trim() || String(text).trim();
    const ttsArgs = voice ? [TTS_PY, spoken, voice] : [TTS_PY, spoken];
    const ttsResult = execFileSync('python3', ttsArgs, {
      timeout: 30000, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024
    }).trim();

    const ttsData = JSON.parse(ttsResult);
    console.log('[#' + id + '] TTS done (' + ttsData.words.length + ' words)');

    safeSend(JSON.stringify({
      id, type: 'result', content: text,
      tts: { audio: ttsData.audio, words: ttsData.words, wtimes: ttsData.wtimes, wdurations: ttsData.wdurations }
    }));
  } catch (err) {
    console.warn('[#' + id + '] TTS failed:', err.message);
    safeSend(JSON.stringify({ id, type: 'result', content: text }));
  }
}

// Loopback only: this session has full tool access, keep it off the LAN.
// Set BRIDGE_HOST=0.0.0.0 only if you know exactly why you want that.
server.listen(PORT, process.env.BRIDGE_HOST || '127.0.0.1', () => {
  console.log('Bridge listening on ws://localhost:' + PORT);
  console.log('─'.repeat(40));
});
