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
const PROXY_BASE  = 'https://max-api-proxy.shanheart95.workers.dev';
const PROXY_CHAT  = `${PROXY_BASE}/api/chat`;
const PROXY_TTS   = `${PROXY_BASE}/api/tts`;
const PROXY_EMAIL = `${PROXY_BASE}/api/email`;
const PROXY_STT   = `${PROXY_BASE}/api/stt`;

/* No legacy JWT path — proxy always uses the real key */
const IS_LEGACY_JWT = false;

/* ── Voice list ─────────────────── */
const VOICES = [
  // ── English voices ────────────────────────────────────────────
  { id: 'English_expressive_narrator',   label: 'Voice A  · Expressive Narrator (M)' },
  { id: 'English_magnetic_voiced_man',   label: 'Voice B  · Magnetic Voice (M)' },
  { id: 'English_Trustworth_Man',        label: 'Voice C  · Trustworthy Man (M)' },
  { id: 'English_Gentle-voiced_man',     label: 'Voice D  · Gentle Voice (M)' },
  { id: 'English_Diligent_Man',          label: 'Voice E  · Diligent Man (M)' },
  { id: 'English_ManWithDeepVoice',      label: 'Voice F  · Deep Voice Man (M)' },
  { id: 'English_FriendlyPerson',        label: 'Voice G  · Friendly Guy (M)' },
  { id: 'English_CaptivatingStoryteller',label: 'Voice H  · Captivating Storyteller (M)' },
  { id: 'English_DecentYoungMan',        label: 'Voice I  · Decent Young Man (M)' },
  { id: 'English_WiseScholar',           label: 'Voice J  · Wise Scholar (M)' },
  { id: 'English_PatientMan',            label: 'Voice K  · Patient Man (M)' },
  { id: 'English_radiant_girl',          label: 'Voice L  · Radiant Girl (F)' },
  { id: 'English_compelling_lady1',      label: 'Voice M  · Compelling Lady (F)' },
  { id: 'English_Upbeat_Woman',          label: 'Voice N  · Upbeat Woman (F)' },
  { id: 'English_CalmWoman',             label: 'Voice O  · Calm Woman (F)' },
  { id: 'English_Graceful_Lady',         label: 'Voice P  · Graceful Lady (F)' },
  { id: 'English_PlayfulGirl',           label: 'Voice Q  · Playful Girl (F)' },
  { id: 'English_Wiselady',              label: 'Voice R  · Wise Lady (F)' },
  { id: 'English_Soft-spokenGirl',       label: 'Voice S  · Soft-Spoken Girl (F)' },
  { id: 'English_SereneWoman',           label: 'Voice T  · Serene Woman (F)' },
  { id: 'English_ConfidentWoman',        label: 'Voice U  · Confident Woman (F)' },
  { id: 'English_SentimentalLady',       label: 'Voice V  · Sentimental Lady (F)' },
  // ── Legacy voices (kept for compatibility) ─────────────────────
  { id: 'presenter_male',               label: 'Voice W  · Presenter Male' },
  { id: 'audiobook_male_1',             label: 'Voice X  · Audiobook Male' },
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
  recBlob:    null,   // raw Blob — kept so shareRecording() needs no async fetch
  recMime:    '',
  corrected:  '',
  improved:   '',
  selectedPanel: 'improved',  // 'corrected' | 'improved' — tracks last panel clicked
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
  originalText:     $('originalText'),
  correctedText:    $('correctedText'),
  improvedText:     $('improvedText'),
  improveLoader:    $('improveLoader'),
  acceptBtn:        $('acceptCorrectionBtn'),
  colCorrected:     $('colCorrected'),
  colImproved:      $('colImproved'),
  checkCorrected:   $('checkCorrected'),
  checkImproved:    $('checkImproved'),
  panelHint:        $('panelHint'),

  // Step 3 dictation
  dictMicSelect:  $('dictMicSelect'),
  dictMicRefresh: $('dictMicRefresh'),
  dictateBtn:     $('dictateBtn'),
  dictMicIcon:    $('dictMicIcon'),
  dictLabel:      $('dictLabel'),
  dictSpinner:    $('dictSpinner'),
  dictStatus:     $('dictStatus'),

  recordLock:    $('recordLock'),
  recordContent: $('recordContent'),
  teleprompter:  $('teleprompter'),
  micSelectRow:  $('micSelectRow'),
  micSelect:     $('micSelect'),
  micRefreshBtn: $('micRefreshBtn'),
  recordBtn:     $('recordBtn'),
  recordBtnLabel:$('recordBtnLabel'),
  recordAgainBtn:$('recordAgainBtn'),
  recStatus:     $('recordingStatus'),
  playbackArea:  $('playbackArea'),
  playbackAudio: $('playbackAudio'),
  downloadBtn:   $('downloadBtn'),

  // Submit / share
  submitBlock:    $('submitBlock'),
  studentName:    $('studentName'),
  studentEmail:   $('studentEmail'),
  emailSubmitBtn: $('emailSubmitBtn'),
  emailLoader:    $('emailLoader'),
  emailSuccess:   $('emailSuccess'),
  shareBtn:       $('shareBtn'),

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
   FETCH WITH TIMEOUT  (prevents infinite spinner)
══════════════════════════════════════════ */
async function fetchWithTimeout(url, options, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Request timed out. Please try again.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
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

  const r = await fetchWithTimeout(PROXY_CHAT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 45000);
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

const SYS_IMPROVE = `You are a disciplined writing assistant following "The Elements of Style" by Strunk and White and MLA citation standards.

Take the grammar-corrected text below and produce ONE improved version with the following strict rules:

WHAT TO CHANGE (minimally):
- Fix awkward phrasing only where it clearly disrupts readability.
- Improve rhythm for natural spoken delivery by adjusting sentence length variation only slightly.
- Remove obvious redundancies or filler words (e.g., "very", "really", "basically").
- Keep verb tenses consistent throughout.
- Make the syllables balanced when reading aloud.

WHAT NOT TO CHANGE:
- Do NOT change the meaning, message, or argument of any sentence.
- Do NOT add new ideas, examples, or content that were not in the original.
- Do NOT remove any important details or facts from the original.
- Do NOT use em dashes (—).
- Do NOT change, correct, or alter anything inside quotation marks.
- Do NOT make the text sound more formal or academic than the original — match the student's register and reading level.

Output ONLY the improved text. No labels, headings, or markdown.`;

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
    dom.article.disabled    = false;
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
    const res = await fetchWithTimeout(PROXY_TTS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        stream: false,
        voice_setting: { voice_id: S.voice.id, speed: 0.9, vol: 1, pitch: 0 },
        audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
      }),
    }, 20000);

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
   DICTATION  (Step 3 — summary textarea)
══════════════════════════════════════════ */
const _dictState = { dictating: false, dictRecorder: null, dictChunks: [], dictStream: null };

async function populateDictMicList() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter(d => d.kind === 'audioinput');
    const prev = dom.dictMicSelect.value;
    dom.dictMicSelect.innerHTML = '<option value="">Default microphone</option>';
    mics.forEach(d => {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || `Microphone ${dom.dictMicSelect.options.length}`;
      dom.dictMicSelect.appendChild(o);
    });
    if ([...dom.dictMicSelect.options].some(o => o.value === prev))
      dom.dictMicSelect.value = prev;
  } catch (_) {}
}

function setDictStatus(msg, isRecording) {
  if (msg) { dom.dictStatus.textContent = msg; show(dom.dictStatus); }
  else hide(dom.dictStatus);
  dom.dictateBtn.classList.toggle('sp-dictate-recording', !!isRecording);
  dom.dictLabel.textContent = isRecording ? 'Stop' : 'Dictate';
  dom.dictMicIcon.style.stroke = isRecording ? '#ef4444' : '';
}

async function toggleDictation() {
  if (_dictState.dictating) {
    if (_dictState.dictRecorder && _dictState.dictRecorder.state !== 'inactive')
      _dictState.dictRecorder.stop();
    return;
  }

  _dictState.dictating  = true;
  _dictState.dictChunks = [];

  const deviceId    = dom.dictMicSelect.value;
  const constraints = { audio: deviceId ? { deviceId: { exact: deviceId } } : true };

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    populateDictMicList();
  } catch (e) {
    _dictState.dictating = false;
    toast('Microphone access denied.', 'error');
    return;
  }

  _dictState.dictStream = stream;

  const mime = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4']
    .find(t => MediaRecorder.isTypeSupported(t)) || '';

  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
  _dictState.dictRecorder = recorder;

  recorder.ondataavailable = e => { if (e.data?.size > 0) _dictState.dictChunks.push(e.data); };

  recorder.onstop = async () => {
    stream.getTracks().forEach(t => t.stop());
    _dictState.dictStream = null;
    _dictState.dictating  = false;
    setDictStatus('', false);

    if (!_dictState.dictChunks.length) return;

    dom.dictateBtn.disabled = true;
    show(dom.dictSpinner);
    dom.dictLabel.textContent = 'Transcribing…';

    try {
      const blob     = new Blob(_dictState.dictChunks, { type: recorder.mimeType || 'audio/webm' });
      const ext      = (recorder.mimeType || '').includes('mp4') ? 'm4a'
                     : (recorder.mimeType || '').includes('ogg') ? 'ogg' : 'webm';
      const formData = new FormData();
      formData.append('audio', blob, `dictation.${ext}`);

      const resp = await fetchWithTimeout(PROXY_STT, {
        method: 'POST',
        body:   formData,
      }, 30000);

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) throw new Error(data.error || `HTTP ${resp.status}`);

      const transcript = (data.text || '').trim();
      if (!transcript) { toast('No speech detected. Try again.', 'warn'); return; }

      /* Insert at cursor position in the summary textarea */
      const ta    = dom.studentSummary;
      const start = ta.selectionStart ?? ta.value.length;
      const end   = ta.selectionEnd   ?? ta.value.length;
      const before  = ta.value.slice(0, start);
      const after   = ta.value.slice(end);
      const spacer  = (before.length && !before.endsWith(' ') && !before.endsWith('\n')) ? ' ' : '';
      ta.value = before + spacer + transcript + after;
      const newPos = start + spacer.length + transcript.length;
      ta.setSelectionRange(newPos, newPos);
      ta.focus();
      toast('Dictation added!', 'success');

    } catch (e) {
      toast(`Transcription failed: ${e.message}`, 'error', 5000);
    } finally {
      hide(dom.dictSpinner);
      dom.dictLabel.textContent = 'Dictate';
      dom.dictateBtn.disabled = false;
    }
  };

  recorder.start();
  setDictStatus('🔴 Recording… click Stop when done', true);
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
    // Run grammar check; once done, kick off improve pass in background
    const result = await callAI(SYS_GRAMMAR, summary, false);
    S.corrected = result;
    S.improved  = '';  // reset; will be filled by improve pass below
    // Show original alongside corrected so student can see what changed
    if (dom.originalText) dom.originalText.textContent = summary;
    dom.correctedText.textContent = result;
    show(dom.correctedArea);
    dom.correctedArea.classList.add('fade-in');
    dom.correctedArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    toast('Grammar check complete! Generating improved version…', 'success');

    // Show improve loader inside the improved panel
    if (dom.improveLoader) show(dom.improveLoader);
    if (dom.improvedText)  { dom.improvedText.textContent = ''; hide(dom.improvedText); }

    // Improve pass on the grammar-corrected text
    const improved = await callAI(SYS_IMPROVE, result, false);
    S.improved = improved;
    if (dom.improvedText)  { dom.improvedText.textContent = improved; show(dom.improvedText); }
    if (dom.improveLoader) hide(dom.improveLoader);
    /* Auto-select the Improved panel (can be overridden by clicking Grammar Corrected) */
    selectPanel('improved');
    toast('Improved version ready! Click a panel to choose, then press Use This for Recording.', 'success');
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
   PANEL SELECTION  (Step 3)
   User clicks Grammar Corrected or Improved column to select it.
   "Use This for Recording" runs a light flow pass on the selected text.
══════════════════════════════════════════ */

/* Light sentence-flow prompt — minimal edits only */
const SYS_FLOW_POLISH = `You are a careful writing assistant. Take the text below and make ONLY very minor improvements to sentence flow and readability. 

STRICT RULES:
- Fix only genuinely awkward transitions or abrupt sentence breaks.
- Add light punctuation (comma, period split) where it clearly aids natural reading aloud.
- Do NOT rewrite sentences from scratch.
- Do NOT replace words with synonyms.
- Do NOT change meaning, facts, argument, or any details.
- Do NOT add new content.
- Do NOT remove anything.
- Do NOT change quoted text.
- Do NOT make it sound more formal.
- Keep every sentence structure as close to the original as possible.
- The result must be recognizably the same text with at most a few tiny tweaks.

Output ONLY the lightly polished text. No labels, no markdown.`;

function selectPanel(panel) {
  S.selectedPanel = panel;

  /* Visual highlight */
  dom.colCorrected.classList.toggle('correction-col-selected', panel === 'corrected');
  dom.colImproved.classList.toggle('correction-col-selected',  panel === 'improved');

  /* Check marks */
  if (panel === 'corrected') { show(dom.checkCorrected); hide(dom.checkImproved); }
  else                       { hide(dom.checkCorrected); show(dom.checkImproved); }

  /* Hide hint once user has made a choice */
  hide(dom.panelHint);
}

/* ══════════════════════════════════════════
   ACCEPT CORRECTION → UNLOCK RECORDING
══════════════════════════════════════════ */
async function acceptCorrection() {
  if (!S.corrected) { toast('Run the grammar check first.', 'warn'); return; }

  /* Determine source text based on last panel clicked */
  const panel = S.selectedPanel;
  let sourceText;
  if (panel === 'corrected') {
    sourceText = S.corrected;
  } else {
    /* 'improved' — wait briefly if the improve pass is still running */
    if (!S.improved) {
      toast('Improved version is still loading. Please wait a moment.', 'warn');
      return;
    }
    sourceText = S.improved;
  }

  /* Disable button and show loading state */
  dom.acceptBtn.disabled = true;
  const origLabel = dom.acceptBtn.innerHTML;
  dom.acceptBtn.innerHTML = '<span class="spin-ring"></span> Polishing flow…';

  let finalText = sourceText;
  try {
    finalText = await callAI(SYS_FLOW_POLISH, sourceText, false);
    if (!finalText || finalText.trim().length < 5) finalText = sourceText; // fallback
  } catch (_) {
    finalText = sourceText; // if AI fails, just use source as-is
  } finally {
    dom.acceptBtn.disabled = false;
    dom.acceptBtn.innerHTML = origLabel;
  }

  dom.teleprompter.textContent = finalText;
  unlock(dom.recordLock);
  show(dom.recordContent);
  dom.recordContent.classList.add('fade-in');
  setHeaderStep(4);
  const card = dom.recordContent.closest('.card');
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const panelName = panel === 'corrected' ? 'Grammar Corrected' : 'Improved';
  toast(`Step 4 unlocked! Using the ${panelName} version with light flow polish.`, 'success');
  populateMicList();
}

/* ══════════════════════════════════════════
   MICROPHONE DEVICE SELECTOR
   Enumerates audio inputs and populates a <select>.
   Labels are empty strings until getUserMedia is granted once —
   so we re-enumerate after the first permission grant.
══════════════════════════════════════════ */
async function populateMicList() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter(d => d.kind === 'audioinput');

    // Save currently selected value so we can restore it
    const prev = dom.micSelect.value;
    dom.micSelect.innerHTML = '';

    // Always offer a "Default" option first
    const defOpt = document.createElement('option');
    defOpt.value = '';
    defOpt.textContent = 'Default microphone';
    dom.micSelect.appendChild(defOpt);

    let hasLabels = false;
    mics.forEach(mic => {
      const opt = document.createElement('option');
      opt.value = mic.deviceId;
      // Before permission is granted, labels are empty — show a placeholder
      const label = mic.label || `Microphone ${dom.micSelect.options.length}`;
      opt.textContent = label;
      if (mic.label) hasLabels = true;
      dom.micSelect.appendChild(opt);
    });

    // Restore previous selection if it still exists
    if (prev && [...dom.micSelect.options].some(o => o.value === prev)) {
      dom.micSelect.value = prev;
    }

    // Show a hint if labels are missing (permission not yet granted)
    if (!hasLabels && mics.length > 0) {
      const hint = document.createElement('option');
      hint.disabled = true;
      hint.textContent = '── Grant mic permission to see device names ──';
      dom.micSelect.insertBefore(hint, dom.micSelect.options[1]);
    }

    console.log(`🎙 ${mics.length} audio input(s) enumerated | labels visible: ${hasLabels}`);
  } catch (e) {
    console.warn('enumerateDevices failed:', e);
  }
}

/* ══════════════════════════════════════════
   AUDIO RECORDING  (v9 — robust rewrite)
   Desktop Chrome/Firefox/Safari compatible.
   Key design decisions:
   1. getSupportedMime() probes real browser support before creating recorder
   2. getUserMedia uses minimal constraints (no sampleRate) — avoids
      NotReadableError on Windows hardware
   3. ondataavailable collects EVERY chunk including zero-size ones to
      avoid missing the final flush
   4. stopRecording wraps recorder.stop() in a Promise so we guarantee
      onstop fires before finaliseRecording() runs
   5. playbackAudio.src + load() resets Chrome's duration-creep bug
   6. S.recBlob kept for synchronous Web Share (no re-fetch)
══════════════════════════════════════════ */
function getSupportedMime() {
  const candidates = [
    'audio/webm;codecs=opus',   // Chrome, Firefox desktop
    'audio/webm',               // Chrome, Firefox fallback
    'audio/ogg;codecs=opus',    // Firefox alt
    'audio/mp4;codecs=mp4a.40.2', // Safari 14.1+
    'audio/mp4',                // Safari fallback
  ];
  for (const t of candidates)
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  return '';
}

async function toggleRecording() {
  if (S.recording) {
    stopRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  /* ── Pre-flight checks ── */
  if (typeof MediaRecorder === 'undefined') {
    toast('Recording is not supported in this browser. Please use Chrome, Firefox, or Safari.', 'error', 8000);
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    const proto = location.protocol;
    const host  = location.hostname;
    if (proto === 'http:' && host !== 'localhost' && host !== '127.0.0.1') {
      toast('Microphone requires HTTPS. Please open the site at https://', 'error', 10000);
    } else {
      toast('Your browser does not support microphone access. Try Chrome or Firefox.', 'error', 8000);
    }
    return;
  }

  /* ── Clear any previous recording ── */
  if (S.recBlobUrl) { revokeURL(S.recBlobUrl); S.recBlobUrl = null; }
  S.recBlob = null;
  S.chunks  = [];

  /* ── Request mic ── */
  // Build audio constraints. If the user picked a specific device, include its
  // deviceId so the exact mic is used. Always add processing hints.
  const selectedDeviceId = dom.micSelect?.value || '';
  const audioConstraints = {
    echoCancellation: { ideal: true },
    noiseSuppression: { ideal: true },
    autoGainControl:  { ideal: true },
  };
  if (selectedDeviceId) {
    audioConstraints.deviceId = { exact: selectedDeviceId };
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
  } catch (e) {
    // If the exact device is gone/unavailable, fall back to default mic
    if (e.name === 'OverconstrainedError' && selectedDeviceId) {
      console.warn('Selected mic unavailable, falling back to default');
      toast('Selected microphone is unavailable — using default.', 'warn', 5000);
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: {
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl:  { ideal: true },
        }});
      } catch (e2) { e = e2; }
    }
    if (!stream) {
    console.error('getUserMedia failed:', e.name, e.message);
      const msgs = {
        NotAllowedError:     'Microphone access denied. Click the 🔒 icon in the address bar, allow the microphone, then try again.',
        PermissionDeniedError:'Microphone access denied. Click the 🔒 icon in the address bar, allow the microphone, then try again.',
        NotFoundError:       'No microphone detected. Please connect a microphone and try again.',
        DevicesNotFoundError:'No microphone detected. Please connect a microphone and try again.',
        NotReadableError:    'Microphone is in use by another application. Close it and try again.',
        TrackStartError:     'Microphone is in use by another application. Close it and try again.',
      };
      toast(msgs[e.name] || `Microphone error: ${e.message}`, 'error', 9000);
      return;
    }
  }

  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    stream.getTracks().forEach(t => t.stop());
    toast('No audio track in the microphone stream. Check your microphone settings.', 'error', 8000);
    return;
  }
  console.log('🎙 Mic:', audioTracks[0].label, JSON.stringify(audioTracks[0].getSettings?.() ?? {}));

  // After permission is granted, mic labels become available — refresh the list
  // so the user can see real device names next time they go to re-record.
  populateMicList();

  S.stream = stream;

  /* ── Create MediaRecorder ── */
  const mime = getSupportedMime();
  try {
    S.recorder = mime
      ? new MediaRecorder(stream, { mimeType: mime })
      : new MediaRecorder(stream);
  } catch (mimeErr) {
    console.warn('MediaRecorder with mimeType failed, using default:', mimeErr.message);
    try { S.recorder = new MediaRecorder(stream); }
    catch (e2) {
      stream.getTracks().forEach(t => t.stop()); S.stream = null;
      toast('Could not start MediaRecorder: ' + e2.message, 'error', 8000);
      return;
    }
  }
  S.recMime = S.recorder.mimeType || mime || 'audio/webm';
  console.log('▶ MediaRecorder ready — mimeType:', S.recorder.mimeType, '| state:', S.recorder.state);

  /* ── Wire events ── */
  S.recorder.ondataavailable = e => {
    if (!e.data) return;
    S.chunks.push(e.data);
    // Log only non-empty chunks so the count is easy to read
    if (e.data.size > 0)
      console.log(`  chunk — ${e.data.size} bytes (total non-empty: ${S.chunks.filter(c=>c.size>0).length})`);
  };

  S.recorder.onerror = e => {
    console.error('MediaRecorder error:', e.error);
    toast('Recording error: ' + (e.error?.message || String(e.error)), 'error', 8000);
    if (S.stream) { S.stream.getTracks().forEach(t => t.stop()); S.stream = null; }
    S.recording = false;
    resetRecordUI();
  };

  /* onstop is called AFTER all ondataavailable events for the final chunk */
  S.recorder.onstop = () => {
    console.log('⏹ Recorder stopped — total chunks:', S.chunks.length,
                '| non-empty:', S.chunks.filter(c => c.size > 0).length);
    if (S.stream) { S.stream.getTracks().forEach(t => t.stop()); S.stream = null; }
    finaliseRecording();
  };

  /* ── Start recording — timeslice 500 ms gives reliable chunks ── */
  S.recorder.start(500);
  console.log('● Recording started — state:', S.recorder.state);

  S.recording = true;
  dom.recordBtn.classList.add('is-recording');
  dom.recordBtnLabel.textContent = 'Stop Recording';
  dom.recordBtn.setAttribute('aria-label', 'Stop recording');
  show(dom.recStatus);
  hide(dom.playbackArea);
  hide(dom.recordAgainBtn);
}

function stopRecording() {
  if (!S.recorder || S.recorder.state === 'inactive') {
    console.warn('stopRecording called but recorder is inactive/null');
    return;
  }
  console.log('⏹ Stopping recorder — current state:', S.recorder.state);
  // requestData() flushes the current in-progress chunk immediately
  try { S.recorder.requestData(); } catch (_) {}
  S.recorder.stop();   // triggers ondataavailable (final) then onstop
  S.recording = false;
  resetRecordUI();
}

function finaliseRecording() {
  // Filter to non-empty chunks only for the blob
  const nonEmpty = S.chunks.filter(c => c.size > 0);
  console.log('Finalising — total chunks:', S.chunks.length, '| non-empty:', nonEmpty.length,
              '| recMime:', S.recMime);

  if (nonEmpty.length === 0) {
    toast('No audio was captured. Check your microphone and try again.', 'warn', 7000);
    hide(dom.recStatus);
    return;
  }

  const mime = S.recMime || 'audio/webm';
  const blob = new Blob(nonEmpty, { type: mime });
  console.log('Blob created — size:', blob.size, 'bytes | type:', blob.type);

  const url = trackURL(URL.createObjectURL(blob));
  S.recBlobUrl = url;
  S.recBlob    = blob;  // stored for synchronous Web Share (no re-fetch needed)

  // Assign src then load() — resets Chrome's Infinity-duration bug
  dom.playbackAudio.src = url;
  dom.playbackAudio.load();
  dom.playbackAudio.addEventListener('loadedmetadata', () => {
    const d = dom.playbackAudio.duration;
    console.log('Audio metadata loaded — duration:', isFinite(d) ? `${d.toFixed(1)}s` : 'unknown');
  }, { once: true });

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
  S.recBlob = null;
  dom.playbackAudio.removeAttribute('src');
  dom.playbackAudio.load();
  hide(dom.playbackArea);
  hide(dom.recordAgainBtn);
  S.chunks = [];
  toast('Ready to record again.', 'info');
}

function downloadRecording() {
  if (!S.recBlobUrl) { toast('No recording to download.', 'warn'); return; }
  // Derive extension from the actual recorded MIME type
  const mime = S.recMime || '';
  let ext = 'webm';
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('mp4a')) ext = 'm4a';
  else if (mime.includes('ogg')) ext = 'ogg';
  else if (mime.includes('webm')) ext = 'webm';
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
   SUBMIT — EMAIL TO TEACHER
   Audio blob → base64 → POST /api/email
   Teacher email is hidden inside the Worker
══════════════════════════════════════════ */
async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => {
      // result is "data:audio/webm;base64,XXXX..." — strip the prefix
      const b64 = reader.result.split(',')[1];
      resolve(b64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function emailRecording() {
  if (!S.recBlobUrl) { toast('Record yourself first.', 'warn'); return; }

  const name = (dom.studentName?.value || '').trim();
  if (!name) {
    toast('Please enter your name before submitting.', 'warn');
    dom.studentName?.focus();
    return;
  }

  const studentEmail = (dom.studentEmail?.value || '').trim();
  if (studentEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(studentEmail)) {
    toast('Please enter a valid email address, or leave it blank.', 'warn');
    dom.studentEmail?.focus();
    return;
  }

  // Get the original blob from the object URL via fetch (simplest approach)
  dom.emailSubmitBtn.disabled = true;
  hide(dom.emailSuccess);
  show(dom.emailLoader);

  try {
    // Fetch the blob back from the object URL
    const blobResp = await fetch(S.recBlobUrl);
    const blob     = await blobResp.blob();

    // Check size — SendGrid attachment limit is 30 MB; warn if large
    if (blob.size > 25 * 1024 * 1024) {
      throw new Error('Recording is too large to email (max ~25 MB). Please record a shorter clip.');
    }

    const audioBase64 = await blobToBase64(blob);

    // Get article title from the article textarea (first 60 chars)
    const articleTitle = (dom.article?.value || '').trim().substring(0, 60) || 'article';

    const payload = {
      studentName: name,
      studentEmail,
      audioBase64,
      audioMime:      S.recMime || 'audio/webm',
      articleTitle,
      speechText:     dom.teleprompter?.textContent.trim() || '',
      speechMode:     'reading-coach',
      clientTime:     new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long' }),
      clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    };

    const r = await fetchWithTimeout(PROXY_EMAIL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, 30000);

    const data = await r.json();
    if (!r.ok || data.error) {
      throw new Error(data.error || `Server error ${r.status}`);
    }

    // Success
    show(dom.emailSuccess);
    dom.emailSuccess.classList.add('fade-in');
    toast(`Recording sent to your teacher! 🎉`, 'success', 6000);

  } catch (e) {
    console.error('Email submit error:', e);
    toast(`Could not send email: ${e.message}`, 'error', 8000);
  } finally {
    hide(dom.emailLoader);
    dom.emailSubmitBtn.disabled = false;
  }
}

/* ══════════════════════════════════════════
   SUBMIT — WEB SHARE API
   Opens native share sheet on mobile
   (WhatsApp, iMessage, WeChat, etc.)
══════════════════════════════════════════ */
function shareRecording() {
  // IMPORTANT: this function must stay synchronous up to the navigator.share() call.
  // Any await before navigator.share() breaks the user-gesture chain and causes
  // 'Permission denied' on Chrome/Safari. We use S.recBlob (stored at finalise time)
  // so no async fetch is needed here.
  if (!S.recBlob) { toast('Record yourself first.', 'warn'); return; }

  const name = (dom.studentName?.value || '').trim() || 'Student';
  const mime = S.recMime || S.recBlob.type || 'audio/webm';
  const ext  = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
  const file = new File([S.recBlob], `max-recording-${name.replace(/\s+/g,'-').toLowerCase()}.${ext}`, { type: mime });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({
      title: `My Recording — ${name}`,
      text:  `Here is my reading recording from the Max app.`,
      files: [file],
    }).then(() => {
      toast('Shared successfully!', 'success', 3000);
    }).catch(e => {
      if (e.name !== 'AbortError') {
        // AbortError = user cancelled the share sheet — not an error
        toast('Sharing failed: ' + e.message, 'error');
      }
    });
  } else if (navigator.share) {
    // Share without file attachment (older browser / desktop)
    navigator.share({
      title: `My Recording — ${name}`,
      text:  `Here is my reading recording from the Max app.`,
    }).catch(e => {
      if (e.name !== 'AbortError') toast('Sharing failed: ' + e.message, 'error');
    });
  } else {
    // Fallback: trigger download instead
    toast('Native sharing is not available in this browser — downloading instead.', 'info', 5000);
    downloadRecording();
  }
}

/* ── Show/hide share button based on Web Share API availability ── */
function initShareButton() {
  if (!dom.shareBtn) return;
  // Web Share is mainly useful on mobile; hide on desktops where it's rarely available
  if (!navigator.share) {
    dom.shareBtn.classList.add('share-unavailable');
  }
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
  initShareButton();
  updateCount();

  dom.article.addEventListener('input', updateCount);
  dom.article.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') analyzeArticle();
  });

  dom.analyzeBtn.addEventListener('click',      analyzeArticle);

  /* Clear article text */
  const clearArticleBtn = document.getElementById('clearArticleBtn');
  if (clearArticleBtn) {
    clearArticleBtn.addEventListener('click', () => {
      dom.article.value = '';
      dom.article.disabled = false;
      dom.charCount.textContent = '0';
      dom.article.focus();
    });
  }

  dom.checkGrammarBtn.addEventListener('click', checkGrammar);
  dom.acceptBtn.addEventListener('click',       acceptCorrection);

  // Step 3 panel selection — click Grammar Corrected or Improved column to choose
  function makePanelSelectable(colEl, panel) {
    if (!colEl) return;
    colEl.addEventListener('click', () => selectPanel(panel));
    colEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPanel(panel); }
    });
  }
  makePanelSelectable(dom.colCorrected, 'corrected');
  makePanelSelectable(dom.colImproved,  'improved');

  // Step 3 dictation listeners
  dom.dictMicRefresh?.addEventListener('click', () => {
    populateDictMicList();
    toast('Microphone list refreshed.', 'info', 2500);
  });
  dom.dictateBtn?.addEventListener('click', toggleDictation);
  dom.listenExplanBtn.addEventListener('click', listenToExplanation);
  dom.recordBtn.addEventListener('click',       toggleRecording);
  dom.recordAgainBtn.addEventListener('click',  recordAgain);
  dom.downloadBtn.addEventListener('click',     downloadRecording);
  dom.emailSubmitBtn?.addEventListener('click', emailRecording);
  dom.shareBtn?.addEventListener('click',       shareRecording);

  // Refresh mic list when user clicks the refresh button
  dom.micRefreshBtn?.addEventListener('click', () => {
    populateMicList();
    toast('Microphone list refreshed.', 'info', 2500);
  });

  // Re-enumerate if devices are plugged in/unplugged
  if (navigator.mediaDevices?.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', populateMicList);
  }
}

document.addEventListener('DOMContentLoaded', init);
