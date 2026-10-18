#!/usr/bin/env node
/**
 * Credentialed end-to-end check of the GEV MIC path with real speech: the WAV
 * is fed to Chromium as a fake microphone, the user clicks GEV MIC, and every
 * stage (token, getUserMedia, WebRTC, data channel, VAD, tool call, UI effect,
 * teardown) is observed from inside the page and printed as a checklist.
 *
 * Run: node scripts/qa-voice-mic.mjs [http://localhost:4189]
 *        [--utterance "Rank the best cities for a budget lifestyle in Europe"]
 *        [--wav path.wav] [--expect-tool rank_cities] [--tier mini|standard]
 *        [--timeout 60] [--lead-ms 4000]
 *
 * --utterance synthesizes speech with OpenAI TTS (gpt-4o-mini-tts, key read
 * from .env/OPENAI_API_KEY, never printed). --wav must be 16-bit PCM. Spends
 * real OpenAI money: one Realtime session per run (default tier: mini).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { readDotenvValue } from './read-dotenv-value.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CITY_INTEL_TOOLS = ['rank_cities', 'compare_cities', 'show_city_intel', 'plan_lifestyle'];
const TTS_RATE = 24_000; // OpenAI `pcm` output: 24 kHz, 16-bit LE, mono.

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : fallback;
};
const positional = argv.filter((arg, i) => !arg.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const targetUrl = new URL(positional[0] || 'http://localhost:4189');
targetUrl.searchParams.set('welcome', '0');
const tier = flag('tier', 'mini');
const timeoutMs = Number(flag('timeout', 60)) * 1000;
const leadMs = Number(flag('lead-ms', 4000));
const expectTool = flag('expect-tool');
const utterance = flag('utterance', flag('wav') ? null : 'Rank the best cities for a budget lifestyle in Europe');

function wavFromPcm16(pcm, sampleRate, leadSilenceMs, tailSilenceMs) {
  const silence = (ms) => Buffer.alloc(Math.round((sampleRate * ms) / 1000) * 2);
  const data = Buffer.concat([silence(leadSilenceMs), pcm, silence(tailSilenceMs)]);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function synthesize(text) {
  const apiKey = process.env.OPENAI_API_KEY || readDotenvValue('OPENAI_API_KEY', repoRoot);
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured (.env or environment)');
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'alloy', input: text, response_format: 'pcm' }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(`OpenAI TTS failed: HTTP ${response.status} ${body?.error?.code || ''} ${body?.error?.message || ''}`.trim());
  }
  const pcm = Buffer.from(await response.arrayBuffer());
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gev-voice-mic-')), 'utterance.wav');
  fs.writeFileSync(file, wavFromPcm16(pcm, TTS_RATE, leadMs, 2000));
  return { file, speechMs: Math.round((pcm.length / 2 / TTS_RATE) * 1000) };
}

// Runs in the page before any app code: records the mic, the peer connection,
// and every Realtime event in/out of the 'oai-events' channel.
function instrumentPage() {
  const log = (window.__qaVoiceMic = { events: [], sent: [], gum: [], pcStates: [], pc: null, dc: null, stream: null });
  const at = () => Math.round(performance.now());
  const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    try {
      const stream = await gum(constraints);
      log.stream = stream;
      // Measure what the mic actually carries on a clone, so the probe outlives
      // the app releasing its own tracks.
      try {
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        ctx.createMediaStreamSource(stream.clone()).connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        log.micPeakRms = 0;
        setInterval(() => {
          analyser.getFloatTimeDomainData(buf);
          const rms = Math.sqrt(buf.reduce((sum, v) => sum + v * v, 0) / buf.length);
          if (rms > log.micPeakRms) log.micPeakRms = rms;
        }, 50);
      } catch { /* probe only */ }
      const track = stream.getAudioTracks()[0];
      log.gum.push({ at: at(), ok: true, label: track?.label || null, readyState: track?.readyState || null, settings: track?.getSettings?.() || null });
      return stream;
    } catch (error) {
      log.gum.push({ at: at(), ok: false, error: `${error?.name}: ${error?.message}` });
      throw error;
    }
  };
  // The app discards the SDP error body (realtimeBackend.js negotiate()); keep
  // OpenAI's error code/message so a billing/quota stop is legible.
  const nativeFetch = window.fetch;
  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    if (String(args[0]).includes('/v1/realtime/calls') && !response.ok) {
      // Read before handing back: the app aborts the request right after.
      try {
        const text = await response.clone().text();
        try { log.sdpError = JSON.parse(text).error || text; } catch { log.sdpError = text.slice(0, 300); }
      } catch (e) { log.sdpError = `unreadable: ${e.message}`; }
    }
    return response;
  };
  const createDataChannel = RTCPeerConnection.prototype.createDataChannel;
  RTCPeerConnection.prototype.createDataChannel = function (label, options) {
    const dc = createDataChannel.call(this, label, options);
    if (label !== 'oai-events') return dc;
    log.pc = this;
    log.dc = dc;
    this.addEventListener('connectionstatechange', () => log.pcStates.push({ at: at(), state: this.connectionState }));
    dc.addEventListener('open', () => log.events.push({ at: at(), type: '(dc.open)' }));
    dc.addEventListener('close', () => log.events.push({ at: at(), type: '(dc.close)' }));
    dc.addEventListener('message', (event) => {
      let payload = null;
      try { payload = JSON.parse(event.data); } catch { return; }
      const entry = { at: at(), type: payload.type };
      if (payload.type === 'response.function_call_arguments.done') Object.assign(entry, { name: payload.name, arguments: payload.arguments, call_id: payload.call_id });
      if (payload.type === 'conversation.item.input_audio_transcription.completed') entry.transcript = payload.transcript;
      if (/transcript\.done$/.test(payload.type)) entry.transcript = payload.transcript;
      if (payload.type === 'response.done') Object.assign(entry, { status: payload.response?.status, usage: payload.response?.usage || null });
      if (payload.type === 'error') entry.error = payload.error;
      if (payload.type === 'session.created' || payload.type === 'session.updated') entry.model = payload.session?.model || null;
      log.events.push(entry);
    });
    return dc;
  };
  const send = RTCDataChannel.prototype.send;
  RTCDataChannel.prototype.send = function (data) {
    if (this === log.dc) {
      try {
        const message = JSON.parse(data);
        const item = message.item;
        log.sent.push({ at: at(), type: message.type, itemType: item?.type || null, call_id: item?.call_id || null, output: item?.type === 'function_call_output' ? item.output : undefined });
      } catch { /* non-JSON */ }
    }
    return send.call(this, data);
  };
}

const wav = utterance ? await synthesize(utterance) : { file: path.resolve(flag('wav')), speechMs: null };
if (!fs.existsSync(wav.file)) {
  console.error(`WAV not found: ${wav.file}`);
  process.exit(2);
}

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: await puppeteer.executablePath(),
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${wav.file}%noloop`,
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1440,900',
  ],
});

const checks = [];
const check = (name, ok, evidence) => checks.push({ name, ok: ok === null ? null : Boolean(ok), evidence });
let report = {};
try {
  await browser.defaultBrowserContext().overridePermissions(targetUrl.origin, ['microphone']);
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((key, value) => {
    try { localStorage.setItem(key, value); } catch { /* storage blocked */ }
  }, 'godsEyeView.voiceCost.tier', tier);
  await page.evaluateOnNewDocument(instrumentPage);

  const consoleErrors = [];
  const consoleVoice = [];
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error') consoleErrors.push(text);
    else if (/voice|realtime|city intel/i.test(text)) consoleVoice.push(`${message.type()}: ${text}`.slice(0, 300));
  });
  page.on('pageerror', (error) => consoleErrors.push(`PAGEERROR: ${error.message}`));
  const http = { token: null, sdp: null };
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/api/realtime/token')) http.token = { status: response.status(), model: response.headers()['x-gev-voice-model'] || null, tier: response.headers()['x-gev-voice-tier'] || null };
    if (url.includes('/v1/realtime/calls')) http.sdp = { status: response.status() };
  });

  await page.goto(targetUrl.href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForFunction(() => (
    window.__godsEyeView?.voiceCommands
    && document.getElementById('gev-voice-button')
    && document.getElementById('loading-screen')?.classList.contains('hidden')
  ), { timeout: 45_000 });

  const readUi = () => page.evaluate(() => {
    const panel = document.getElementById('city-intel-panel');
    const text = (id) => document.getElementById(id)?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 240) || null;
    return {
      voiceStatus: window.__godsEyeView.voiceCommands.status || null,
      voiceDetail: text('gev-voice-detail'),
      cityIntelMode: document.body.classList.contains('city-intel-mode'),
      panelVisible: Boolean(panel && !panel.hidden),
      ciStatus: text('ci-status'),
      ciList: text('ci-list'),
      ciPlan: text('ci-plan-view'),
    };
  });
  const uiBefore = await readUi();
  const startedAt = Date.now();
  await page.click('#gev-voice-button');

  // Done once a tool output was sent and the model finished the follow-up
  // (spoken) response, or on error/timeout.
  const readLog = () => page.evaluate(() => {
    const l = window.__qaVoiceMic;
    return { events: l.events, sent: l.sent, gum: l.gum, pcStates: l.pcStates, dcState: l.dc?.readyState || null, pcState: l.pc?.connectionState || null };
  });
  let log = await readLog();
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    log = await readLog();
    const outputAt = log.sent.find((s) => s.itemType === 'function_call_output')?.at;
    const followUpDone = outputAt != null && log.events.some((e) => e.type === 'response.done' && e.at > outputAt);
    if (followUpDone || (await page.evaluate(() => window.__godsEyeView.voiceCommands.status)) === 'error') break;
  }
  const uiAfterTool = await readUi();
  const cost = await page.evaluate(() => window.__godsEyeView.voiceCommands.getDiagnostics?.()?.cost || null);

  // Teardown the way a user does: click GEV MIC again — only while active,
  // because a click in the error state starts a fresh (billed) session.
  if (await page.$eval('#gev-voice-button', (b) => b.getAttribute('aria-pressed') === 'true')) {
    await page.click('#gev-voice-button');
  }
  await page.waitForFunction(() => window.__godsEyeView.voiceCommands.status === 'idle', { timeout: 10_000 }).catch(() => {});
  const teardown = await page.evaluate(() => {
    const l = window.__qaVoiceMic;
    return {
      status: window.__godsEyeView.voiceCommands.status,
      tracks: l.stream?.getTracks().map((t) => t.readyState) || [],
      pcState: l.pc?.connectionState || null,
      pcSignaling: l.pc?.signalingState || null,
      dcState: l.dc?.readyState || null,
      audioElements: document.querySelectorAll('audio[data-gev-realtime-audio="true"]').length,
      micPeakRms: Number((l.micPeakRms || 0).toFixed(4)),
      sdpError: l.sdpError || null,
      lastError: window.__godsEyeView.voiceCommands.getDiagnostics?.()?.recentErrors?.[0] || null,
    };
  });

  const types = new Set(log.events.map((e) => e.type));
  const calls = log.events.filter((e) => e.type === 'response.function_call_arguments.done');
  const cityCalls = calls.filter((c) => CITY_INTEL_TOOLS.includes(c.name));
  const outputs = log.sent.filter((s) => s.itemType === 'function_call_output').map((s) => {
    let parsed = null;
    try { parsed = JSON.parse(s.output); } catch { /* keep raw */ }
    return { call_id: s.call_id, ok: parsed?.ok ?? null, action: parsed?.action ?? null, summary: parsed?.summary ?? parsed?.error ?? null };
  });
  const expected = expectTool ? calls.filter((c) => c.name === expectTool) : cityCalls;
  const expectedOutputs = outputs.filter((o) => expected.some((c) => c.call_id === o.call_id));
  const gum = log.gum[0];
  const assistantText = log.events.filter((e) => /output_audio_transcript\.done$|audio_transcript\.done$/.test(e.type)).map((e) => e.transcript);
  const userText = log.events.filter((e) => e.type === 'conversation.item.input_audio_transcription.completed').map((e) => e.transcript);
  const realtimeErrors = log.events.filter((e) => e.type === 'error').map((e) => e.error);
  const voiceConsoleErrors = consoleErrors.filter((t) => /realtime|voice|city ?intel|PAGEERROR/i.test(t));

  check('token minted', http.token?.status === 200, http.token);
  check(`served model matches tier=${tier}`, tier !== 'mini' || /mini/.test(http.token?.model || ''), http.token?.model);
  check('getUserMedia resolved with a live audio track', gum?.ok && gum.readyState === 'live', gum);
  check('fake mic carried audio (peak RMS > 0.01)', teardown.micPeakRms > 0.01, teardown.micPeakRms);
  check('SDP negotiated with OpenAI', http.sdp && http.sdp.status < 300, { ...http.sdp, error: teardown.sdpError });
  check('RTCPeerConnection connected', log.pcStates.some((s) => s.state === 'connected'), log.pcStates.map((s) => s.state).join(' -> '));
  check('data channel open', types.has('(dc.open)'), types.has('session.created') ? 'session.created received' : 'no session.created');
  check('VAD speech_started', types.has('input_audio_buffer.speech_started'), null);
  check('VAD speech_stopped', types.has('input_audio_buffer.speech_stopped'), null);
  check('user transcription (informational: session config enables none)', userText.length ? true : null, userText.length ? userText : 'no input_audio_transcription events');
  check(expectTool ? `model called ${expectTool}` : 'model called a City Intel tool', expected.length > 0, calls.map((c) => `${c.name}(${c.arguments})`));
  check('tool output ok:true sent back', expectedOutputs.length > 0 && expectedOutputs.every((o) => o.ok === true), expectedOutputs);
  check('City Intel UI changed (mode on, panel visible)', uiAfterTool.cityIntelMode && uiAfterTool.panelVisible && !uiBefore.panelVisible, { before: uiBefore, after: uiAfterTool });
  check('model answered after the tool', log.events.some((e) => e.type === 'response.done' && e.at > (log.sent.find((s) => s.itemType === 'function_call_output')?.at ?? Infinity)), assistantText);
  check('no Realtime error events', realtimeErrors.length === 0, realtimeErrors);
  check('no voice/page console errors', voiceConsoleErrors.length === 0, voiceConsoleErrors);
  check('teardown: idle, mic released, pc/dc closed', (teardown.status === 'idle' || (teardown.status === 'error' && log.pcStates.length === 0)) && teardown.tracks.every((s) => s === 'ended') && teardown.pcState === 'closed' && teardown.dcState === 'closed' && teardown.audioElements === 0, teardown);

  report = {
    appUrl: targetUrl.href,
    wav: wav.file,
    utterance,
    speechMs: wav.speechMs,
    tier,
    elapsedMs: Date.now() - startedAt,
    costUsd: cost?.totalUsd ?? null,
    lastVoiceError: teardown.lastError,
    timeline: log.events.map((e) => `${e.at} ${e.type}${e.name ? ` ${e.name}` : ''}`),
    consoleErrors,
    consoleVoice: consoleVoice.slice(0, 20),
  };
} finally {
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
console.log('\nChecklist:');
for (const c of checks) {
  const mark = c.ok === null ? 'INFO' : c.ok ? 'PASS' : 'FAIL';
  const evidence = c.evidence == null ? '' : ` — ${typeof c.evidence === 'string' ? c.evidence : JSON.stringify(c.evidence)}`;
  console.log(`  [${mark}] ${c.name}${evidence.slice(0, 600)}`);
}
const failed = checks.filter((c) => c.ok === false).length;
console.log(`\n${failed ? 'FAIL' : 'PASS'}: ${checks.length - failed}/${checks.length} checks (${checks.filter((c) => c.ok === null).length} informational)`);
process.exitCode = failed ? 1 : 0;
