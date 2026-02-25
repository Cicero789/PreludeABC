/**
 * Max — app.js  (v5)
 * All API calls now routed through Cloudflare Worker proxy.
 * No API keys are stored in the browser at all — config.js is empty.
 */
'use strict';

/* ══════════════════════════════════════════
   CONFIG  — all API calls go through the
   Cloudflare Worker proxy; no keys in browser
══════════════════════════════════════════ */
const PROXY_BASE = 'https://max-api-proxy.shanheart95.workers.dev';
const PROXY_CHAT = `${PROXY_BASE}/api/chat`;
const PROXY_TTS  = `${PROXY_BASE}/api/tts`;

/* No legacy JWT path — proxy always uses the real key */
const IS_LEGACY_JWT = false;

/* ── Voice list ─────────────────── */
const VOICES = [
  { id: 'male-qn-qingse',     label: 'Voice A' },
  { id: 'male-qn-jingying',   label: 'Voice B' },
  { id: 'male-qn-badao',      label: 'Voice C' },
  { id: 'male-qn-daxuesheng', label: 'Voice D' },
  { id: 'female-shaonv',      label: 'Voice E' },
  { id: 'female-yujie',       label: 'Voice F' },
  { id: 'female-chengshu',    label: 'Voice G' },
  { id: 'female-tianmei',     label: 'Voice H' },
  { id: 'presenter_male',     label: 'Voice I' },
  { id: 'audiobook_male_1',   label: 'Voice J' },
];

/* ══════════════════════════════════════════
   SESSION STATE  (ephemeral — tab memory only)
══════════════════════════════════════════ */
const S = {
  voice:      null,
  ttsCache:   {},
  objectURLs: [],
  recorder:   null,
  stream:     null,   // keep mic stream ref so we can stop tracks in onstop
  chunks:     [],
  recBlobUrl: null,
  recMime:    '',
  corrected:  '',
  recording:  false,
};

/* ══════════════════════════════════════════
   DOM  REFERENCES
══════════════════════════════════════════ */
const $   = id => document.getElementById(id);
const dom = {
  article:         $('articleText'),
  charCount:       $('charCount'),
  analyzeBtn:      $('analyzeBtn'),
  globalLoader:    $('globalLoader'),

  hstep1: $('hstep1'), hstep2: $('hstep2'),
  hstep3: $('hstep3'), hstep4: $('hstep4'),
  ps1: $('ps1'), ps2: $('ps2'), ps3: $('ps3'),

  explainLock:       $('explainLock'),
  explainSkeleton:   $('explainSkeleton'),
  explainContent:    $('explainContent'),
  explanationText:   $('explanationText'),
  listenExplanBtn:   $('listenExplanationBtn'),
  listenExplanLabel: $('listenExplanationLabel'),
  vocabGrid:         $('vocabGrid'),
  voiceLabel:        $('voiceLabel'),
  voiceName:         $('voiceName'),

  summaryLock:      $('summaryLock'),
  outlineSkeleton:  $('outlineSkeleton'),
  outlineContent:   $('outlineContent'),
  outlineList:      $('outlineList'),
  summaryInputArea: $('summaryInputArea'),
  studentSummary:   $('studentSummary'),
  checkGrammarBtn:  $('checkGrammarBtn'),
  grammarLoader:    $('grammarLoader'),
  correctedArea:    $('correctedArea'),
  correctedText:    $('correctedText'),
  acceptBtn:        $('acceptCorrectionBtn'),

  recordLock:    $('recordLock'),
  recordContent: $('recordContent'),
  teleprompter:  $('teleprompter'),
  recordBtn:     $('recordBtn'),
  recordBtnLabel:$('recordBtnLabel'),
  recordAgainBtn:$('recordAgainBtn'),
  recStatus:     $('recordingStatus'),
  playbackArea:  $('playbackArea'),
  playbackAudio: $('playbackAudio'),
  downloadBtn:   $('downloadBtn'),

  ttsAudio:       $('ttsAudio'),
  toastContainer: $('toastContainer'),
};

/* ══════════════════════════════════════════
   HELPERS
══════════════════════════════════════════ */
const show = el => { if (el) el.hidden = false; };
const hide = el => { if (el) el.hidden = true; };

function unlock(gate) {
  if (gate) gate.classList.add('hidden-gate');
}

function trackURL(url) { S.objectURLs.push(url); return url; }
function revokeURL(url) {
  if (!url) return;
  URL.revokeObjectURL(url);
  S.objectURLs = S.objectURLs.filter(u => u !== url);
}

function setHeaderStep(n) {
  [dom.hstep1, dom.hstep2, dom.hstep3, dom.hstep4].forEach((el, i) => {
    el.classList.remove('active', 'done');
    if (i + 1 < n)  el.classList.add('done');
    if (i + 1 === n) el.classList.add('active');
  });
}

function toast(msg, type = 'info', ms = 4500) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warn: '⚠️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${msg}</span>`;
  dom.toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add('hiding');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, ms);
}

/* ══════════════════════════════════════════
   VOICE INIT
══════════════════════════════════════════ */
function initVoice() {
  S.voice = VOICES[Math.floor(Math.random() * VOICES.length)];
  // Pre-warm browser speech voices (async load in Chrome)
  if (window.speechSynthesis) window.speechSynthesis.getVoices();
  console.log(`%c Max ready · ${IS_LEGACY_JWT ? 'browser TTS' : 'HD voice: ' + S.voice.label} `,
    'background:#d97706;color:#fff;font-weight:700;border-radius:4px;');
}

/* ══════════════════════════════════════════
   OPENAI  CALLS
══════════════════════════════════════════ */
async function callAI(system, user, json = false) {
  const body = {
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.4,
  };
  if (json) body.response_format = { type: 'json_object' };

  const r = await fetch(PROXY_CHAT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e?.error?.message || `Error ${r.status}`);
  }
  const d = await r.json();
  return d.choices[0].message.content.trim();
}

const SYS_EXPLAIN = `You are a helpful tutor. Given the article below, write a clear plain-language explanation suitable for a high-school student. Then identify 8-12 difficult or important words and give a simple definition for each. Return ONLY valid JSON with keys "explanation" (string) and "vocabulary" (array of {word, definition}). No markdown, no code fences.`;
const SYS_OUTLINE = `Based on the article, create 4-6 short bullet-point hints to help a high-school student write a summary. Return plain text, one hint per line starting with '-'. No extra formatting.`;
const SYS_GRAMMAR = `Correct only grammar errors in the student's summary. Preserve their wording, style, and voice. Make minimal changes only for clarity. Return only the corrected text, nothing else.`;

/* ══════════════════════════════════════════
   ARTICLE ANALYSIS
══════════════════════════════════════════ */
async function analyzeArticle() {
  const text = dom.article.value.trim();
  if (!text)            return toast('Please paste an article first.', 'warn');
  if (text.length < 80) return toast('Article is too short. Paste a longer text.', 'warn');

  dom.article.disabled    = true;
  dom.analyzeBtn.disabled = true;
  dom.analyzeBtn.innerHTML = `<span class="spin-ring" style="border-top-color:#fff"></span> Analyzing…`;
  show(dom.globalLoader);
  dom.ps1.classList.add('active');

  unlock(dom.explainLock);
  unlock(dom.summaryLock);
  show(dom.explainSkeleton);
  show(dom.outlineSkeleton);
  setHeaderStep(2);

  try {
    setTimeout(() => { dom.ps1.classList.remove('active'); dom.ps2.classList.add('active'); }, 800);
    setTimeout(() => { dom.ps2.classList.remove('active'); dom.ps3.classList.add('active'); }, 2200);

    const [explainRaw, outlineRaw] = await Promise.all([
      callAI(SYS_EXPLAIN, text, true),
      callAI(SYS_OUTLINE, text, false),
    ]);

    let parsed;
    try { parsed = JSON.parse(explainRaw); }
    catch {
      const m = explainRaw.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
      else throw new Error('Could not parse response. Please try again.');
    }

    renderExplanation(parsed.explanation || '', parsed.vocabulary || []);
    hide(dom.explainSkeleton);
    show(dom.explainContent);
    dom.explainContent.classList.add('fade-in');

    // Voice badge — no service name, just the voice label
    dom.voiceName.textContent = S.voice.label;
    show(dom.voiceLabel);

    const hints = outlineRaw.split('\n')
      .map(l => l.replace(/^[-•*·]\s*/, '').trim()).filter(Boolean);
    renderOutline(hints);
    hide(dom.outlineSkeleton);
    show(dom.outlineContent);
    show(dom.summaryInputArea);
    dom.outlineContent.classList.add('fade-in');

    setHeaderStep(3);
    toast('Article analyzed! Read the explanation, then write your summary.', 'success');

  } catch (err) {
    console.error(err);
    toast(`Analysis failed: ${err.message}`, 'error', 6000);
    dom.explainLock.classList.remove('hidden-gate');
    dom.summaryLock.classList.remove('hidden-gate');
    hide(dom.explainSkeleton);
    hide(dom.outlineSkeleton);
    dom.article.disabled = false;
    setHeaderStep(1);
  } finally {
    hide(dom.globalLoader);
    ['ps1','ps2','ps3'].forEach(id => dom[id].classList.remove('active'));
    dom.analyzeBtn.disabled = false;
    dom.analyzeBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      Analyze Article`;
  }
}

/* ══════════════════════════════════════════
   RENDER
══════════════════════════════════════════ */
function renderExplanation(explanation, vocabulary) {
  dom.explanationText.textContent = explanation;
  dom.vocabGrid.innerHTML = '';
  vocabulary.forEach(({ word, definition }) => {
    const card = document.createElement('div');
    card.className = 'vocab-card';
    card.setAttribute('role', 'listitem');

    const wordEl = document.createElement('div');
    wordEl.className = 'vocab-word';
    wordEl.textContent = word;

    const defEl = document.createElement('div');
    defEl.className = 'vocab-def';
    defEl.textContent = definition;

    const actEl = document.createElement('div');
    actEl.className = 'vocab-actions';

    const btn = document.createElement('button');
    btn.className = 'btn-listen';
    btn.setAttribute('aria-label', `Listen to: ${word} — ${definition}`);
    btn.innerHTML = VOCAB_LISTEN_DEFAULT;
    btn.addEventListener('click', () => listenToVocab(word, definition, btn));

    actEl.appendChild(btn);
    card.append(wordEl, defEl, actEl);
    dom.vocabGrid.appendChild(card);
  });
}

function renderOutline(hints) {
  dom.outlineList.innerHTML = '';
  hints.forEach(hint => {
    const li = document.createElement('li');
    li.textContent = hint;
    dom.outlineList.appendChild(li);
  });
}

/* ══════════════════════════════════════════
   TTS — tries HD service first, falls back to Web Speech
══════════════════════════════════════════ */
async function callTTS(text, btn, labelDefault, cacheKey) {
  const key = cacheKey || text;

  if (S.ttsCache[key]) {
    setListenPlaying(btn, labelDefault);
    playURL(S.ttsCache[key], () => setListenIdle(btn, labelDefault));
    return;
  }

  // Show loading state on button only
  btn.disabled = true;
  btn.innerHTML = `<span class="spin-ring" style="width:12px;height:12px;border-width:2px;border-top-color:currentColor;flex-shrink:0"></span> Loading…`;

  if (IS_LEGACY_JWT) {
    btn.disabled = false;
    speakWithWebSpeech(text, btn, labelDefault);
    return;
  }

  try {
    const res = await fetch(PROXY_TTS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        stream: false,
        voice_setting: { voice_id: S.voice.id, speed: 0.9, vol: 1, pitch: 0 },
        audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
      }),
    });

    const data = await res.json();
    if (data?.base_resp?.status_code && data.base_resp.status_code !== 0)
      throw new Error(`TTS error ${data.base_resp.status_code}`);
    if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
    if (!data?.data?.audio) throw new Error('No audio in response');

    const hex   = data.data.audio;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++)
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);

    const blob = new Blob([bytes], { type: 'audio/mpeg' });
    const url  = trackURL(URL.createObjectURL(blob));
    S.ttsCache[key] = url;

    btn.disabled = false;
    setListenPlaying(btn, labelDefault);
    playURL(url, () => setListenIdle(btn, labelDefault));

  } catch (e) {
    console.warn('HD TTS failed, using browser speech:', e.message);
    btn.disabled = false;
    speakWithWebSpeech(text, btn, labelDefault);
  }
}

/* ── Web Speech fallback ──────────────── */
function getVoicesAsync() {
  return new Promise(resolve => {
    const synth = window.speechSynthesis;
    const v = synth.getVoices();
    if (v.length > 0) { resolve(v); return; }
    synth.addEventListener('voiceschanged', () => resolve(synth.getVoices()), { once: true });
    setTimeout(() => resolve(synth.getVoices()), 2000);
  });
}

function pickEnglishVoice(voices) {
  const en = voices.filter(v => v.lang.startsWith('en'));
  return en.find(v => /natural|neural|premium/i.test(v.name))
      || en.find(v => /female|woman|girl/i.test(v.name))
      || en[0] || null;
}

async function speakWithWebSpeech(text, btn, labelDefault) {
  if (!window.speechSynthesis) {
    toast('Audio not supported in this browser.', 'warn');
    setListenIdle(btn, labelDefault);
    return;
  }
  window.speechSynthesis.cancel();
  const voices = await getVoicesAsync();
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = 0.88; utt.pitch = 1; utt.volume = 1;
  const voice = pickEnglishVoice(voices);
  if (voice) utt.voice = voice;
  utt.onstart = () => setListenPlaying(btn, labelDefault);
  utt.onend   = () => setListenIdle(btn, labelDefault);
  utt.onerror = () => setListenIdle(btn, labelDefault);
  window.speechSynthesis.speak(utt);
}

/* ── Button state ─────────────────────── */
function setListenPlaying(btn, labelDefault) {
  btn.classList.add('is-playing');
  if (btn === dom.listenExplanBtn) {
    dom.listenExplanLabel.textContent = '▐▐  Playing…';
  } else {
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Playing…`;
  }
}

function setListenIdle(btn, labelDefault) {
  btn.classList.remove('is-playing');
  btn.disabled = false;
  if (btn === dom.listenExplanBtn) {
    dom.listenExplanLabel.textContent = 'Listen to Explanation';
  } else {
    btn.innerHTML = labelDefault;
  }
}

function playURL(url, onEnd) {
  dom.ttsAudio.src = url;
  const done = () => { if (onEnd) onEnd(); };
  dom.ttsAudio.addEventListener('ended', done, { once: true });
  dom.ttsAudio.addEventListener('error', done, { once: true });
  dom.ttsAudio.play().catch(err => {
    console.warn('Audio play failed:', err);
    toast('Could not play audio.', 'warn');
    done();
  });
}

function listenToExplanation() {
  const text = dom.explanationText.textContent.trim();
  if (!text) return;
  callTTS(text, dom.listenExplanBtn, null, '__explanation__');
}

const VOCAB_LISTEN_ICON    = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
const VOCAB_LISTEN_DEFAULT = `${VOCAB_LISTEN_ICON} Listen: word &amp; definition`;

function listenToVocab(word, definition, btn) {
  callTTS(`${word}. ${definition}`, btn, VOCAB_LISTEN_DEFAULT, `vocab::${word}`);
}

/* ══════════════════════════════════════════
   GRAMMAR CHECK
   • Button label stays static — no spinner on the button itself
   • Only the separate grammarLoader div animates
══════════════════════════════════════════ */
async function checkGrammar() {
  const summary = dom.studentSummary.value.trim();
  if (!summary)                        return toast('Write your summary first.', 'warn');
  if (summary.split(/\s+/).length < 8) return toast('Summary is too short.', 'warn');

  // Disable button but keep its label unchanged (no spinner inside it)
  dom.checkGrammarBtn.disabled = true;
  show(dom.grammarLoader);
  hide(dom.correctedArea);

  try {
    const result = await callAI(SYS_GRAMMAR, summary, false);
    S.corrected = result;
    dom.correctedText.textContent = result;
    show(dom.correctedArea);
    dom.correctedArea.classList.add('fade-in');
    dom.correctedArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    toast('Grammar check complete!', 'success');
  } catch (e) {
    console.error(e);
    toast(`Grammar check failed: ${e.message}`, 'error');
  } finally {
    hide(dom.grammarLoader);
    dom.checkGrammarBtn.disabled = false;
    // Restore original button content explicitly
    dom.checkGrammarBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Check Grammar`;
  }
}

/* ══════════════════════════════════════════
   ACCEPT CORRECTION → UNLOCK RECORDING
══════════════════════════════════════════ */
function acceptCorrection() {
  if (!S.corrected) { toast('Run the grammar check first.', 'warn'); return; }
  dom.teleprompter.textContent = S.corrected;
  unlock(dom.recordLock);
  show(dom.recordContent);
  dom.recordContent.classList.add('fade-in');
  setHeaderStep(4);
  const card = dom.recordContent.closest('.card');
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  toast('Step 4 unlocked! Read the text aloud and record yourself.', 'success');
}

/* ══════════════════════════════════════════
   AUDIO RECORDING
   Key fixes vs previous version:
   1. S.stream stored separately — tracks stopped inside onstop, AFTER
      the blob is assembled, not before (stopping tracks early truncates audio)
   2. recorder.requestData() called before stop() to flush the last chunk
   3. playbackAudio.load() called after setting .src to reset duration
      (Chrome's duration-creep bug when you reuse an <audio> element)
   4. Download: proper anchor-click with revokeObjectURL cleanup
══════════════════════════════════════════ */
function getSupportedMime() {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'])
    if (MediaRecorder.isTypeSupported(t)) return t;
  return '';
}

async function toggleRecording() {
  S.recording ? stopRecording() : await startRecording();
}

async function startRecording() {
  // Clear any previous recording
  if (S.recBlobUrl) { revokeURL(S.recBlobUrl); S.recBlobUrl = null; }

  try {
    S.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });

    S.chunks = [];
    S.recMime = getSupportedMime();
    S.recorder = new MediaRecorder(S.stream, S.recMime ? { mimeType: S.recMime } : {});

    S.recorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) S.chunks.push(e.data);
    };

    S.recorder.onstop = () => {
      // Stop all mic tracks AFTER the recorder has stopped (data is flushed)
      S.stream.getTracks().forEach(t => t.stop());
      S.stream = null;
      finaliseRecording();
    };

    S.recorder.onerror = () => { toast('Recording error.', 'error'); resetRecordUI(); };

    // Collect chunks every 250 ms for smooth progress
    S.recorder.start(250);

    S.recording = true;
    dom.recordBtn.classList.add('is-recording');
    dom.recordBtnLabel.textContent = 'Stop Recording';
    dom.recordBtn.setAttribute('aria-label', 'Stop recording');
    show(dom.recStatus);
    hide(dom.playbackArea);
    hide(dom.recordAgainBtn);

  } catch (e) {
    console.error(e);
    const msg = (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError')
      ? 'Microphone access denied. Please allow microphone in your browser settings.'
      : `Cannot start recording: ${e.message}`;
    toast(msg, 'error', 7000);
  }
}

function stopRecording() {
  if (!S.recorder || S.recorder.state === 'inactive') return;
  // Flush the final data chunk before stopping
  try { S.recorder.requestData(); } catch (_) {}
  S.recorder.stop();
  S.recording = false;
  resetRecordUI();
}

function finaliseRecording() {
  if (S.chunks.length === 0) {
    toast('No audio was captured. Please try again.', 'warn');
    return;
  }

  const mime = S.recMime || 'audio/webm';
  const blob = new Blob(S.chunks, { type: mime });
  const url  = trackURL(URL.createObjectURL(blob));
  S.recBlobUrl = url;

  // Fix Chrome duration-creep: set src, then call load() to reset metadata
  dom.playbackAudio.src = url;
  dom.playbackAudio.load();

  hide(dom.recStatus);
  show(dom.playbackArea);
  show(dom.recordAgainBtn);
  dom.playbackArea.classList.add('fade-in');
  toast('Recording ready! Press ▶ to listen.', 'success');
}

function resetRecordUI() {
  dom.recordBtn.classList.remove('is-recording');
  dom.recordBtnLabel.textContent = 'Start Recording';
  dom.recordBtn.setAttribute('aria-label', 'Start recording');
  hide(dom.recStatus);
}

function recordAgain() {
  if (S.recBlobUrl) { revokeURL(S.recBlobUrl); S.recBlobUrl = null; }
  dom.playbackAudio.removeAttribute('src');
  dom.playbackAudio.load();
  hide(dom.playbackArea);
  hide(dom.recordAgainBtn);
  S.chunks = [];
  toast('Ready to record again.', 'info');
}

function downloadRecording() {
  if (!S.recBlobUrl) { toast('No recording to download.', 'warn'); return; }
  const ext  = S.recMime.includes('mp4') ? 'm4a' : S.recMime.includes('ogg') ? 'ogg' : 'webm';
  const name = `max-recording.${ext}`;
  const a    = document.createElement('a');
  a.href     = S.recBlobUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  toast(`Downloading ${name}…`, 'info', 3000);
}

/* ══════════════════════════════════════════
   CHAR COUNTER
══════════════════════════════════════════ */
function updateCount() {
  dom.charCount.textContent = dom.article.value.length.toLocaleString();
}

/* ══════════════════════════════════════════
   CLEANUP ON TAB CLOSE
══════════════════════════════════════════ */
window.addEventListener('beforeunload', () => {
  S.objectURLs.forEach(URL.revokeObjectURL.bind(URL));
  if (S.recorder?.state !== 'inactive') try { S.recorder.stop(); } catch (_) {}
  if (S.stream) S.stream.getTracks().forEach(t => t.stop());
  if (window.speechSynthesis) window.speechSynthesis.cancel();
});

/* ══════════════════════════════════════════
   INIT
══════════════════════════════════════════ */
function init() {
  initVoice();
  updateCount();

  dom.article.addEventListener('input', updateCount);
  dom.article.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') analyzeArticle();
  });

  dom.analyzeBtn.addEventListener('click',      analyzeArticle);
  dom.checkGrammarBtn.addEventListener('click', checkGrammar);
  dom.acceptBtn.addEventListener('click',       acceptCorrection);
  dom.listenExplanBtn.addEventListener('click', listenToExplanation);
  dom.recordBtn.addEventListener('click',       toggleRecording);
  dom.recordAgainBtn.addEventListener('click',  recordAgain);
  dom.downloadBtn.addEventListener('click',     downloadRecording);
}

document.addEventListener('DOMContentLoaded', init);
