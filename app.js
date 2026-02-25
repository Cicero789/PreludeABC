/**
 * ReadSmart — app.js
 * Interactive Article Summarizer with Audio & Grammar Check
 * All data is ephemeral (lives only in this tab's memory).
 */

'use strict';

/* ══════════════════════════════════════════════
   1.  CONFIGURATION & CONSTANTS
══════════════════════════════════════════════ */

// Keys are loaded from config.js (excluded from version control)
const OPENAI_API_KEY   = window.APP_CONFIG?.OPENAI_API_KEY  || '';
const OPENAI_BASE_URL  = 'https://api.openai.com/v1';
const OPENAI_MODEL     = 'gpt-4o';

const MINIMAX_API_KEY  = window.APP_CONFIG?.MINIMAX_API_KEY  || '';
const MINIMAX_GROUP_ID = window.APP_CONFIG?.MINIMAX_GROUP_ID || '';
const MINIMAX_TTS_URL  = `https://api.minimax.chat/v1/t2a_v2?GroupId=${MINIMAX_GROUP_ID}`;

/** Full list of available MiniMax voices */
const MINIMAX_VOICES = [
  { id: 'male-qn-qingse',       label: 'Qingse (M)'    },
  { id: 'male-qn-jingying',     label: 'Jingying (M)'  },
  { id: 'male-qn-badao',        label: 'Badao (M)'      },
  { id: 'male-qn-daxuesheng',   label: 'Daxuesheng (M)' },
  { id: 'female-shaonv',        label: 'Shaonv (F)'     },
  { id: 'female-yujie',         label: 'Yujie (F)'      },
  { id: 'female-chengshu',      label: 'Chengshu (F)'   },
  { id: 'female-tianmei',       label: 'Tianmei (F)'    },
  { id: 'presenter_male',       label: 'Presenter (M)'  },
  { id: 'audiobook_male_1',     label: 'Audiobook (M)'  },
];

/* ══════════════════════════════════════════════
   2.  SESSION STATE  (all ephemeral)
══════════════════════════════════════════════ */
const session = {
  articleText:      '',
  explanation:      '',
  vocabulary:       [],   // [{word, definition}]
  outlineHints:     [],   // [string]
  correctedSummary: '',
  selectedVoice:    null, // {id, label}
  ttsCache:         {},   // word → Blob URL  (lazy cache)
  recordedBlobUrl:  null,
  mediaRecorder:    null,
  audioChunks:      [],
  objectURLs:       [],   // all created object URLs — revoked on unload
};

/* ══════════════════════════════════════════════
   3.  DOM REFS
══════════════════════════════════════════════ */
const dom = {
  // Section 1
  articleText:    document.getElementById('articleText'),
  charCount:      document.getElementById('charCount'),
  analyzeBtn:     document.getElementById('analyzeBtn'),
  globalLoader:   document.getElementById('globalLoader'),

  // Section 2
  cardExplain:    document.getElementById('card-explain'),
  explainLock:    document.getElementById('explainLock'),
  explainSkeleton:document.getElementById('explainSkeleton'),
  explainContent: document.getElementById('explainContent'),
  explanationText:document.getElementById('explanationText'),
  vocabGrid:      document.getElementById('vocabGrid'),
  voiceLabel:     document.getElementById('voiceLabel'),

  // Section 3
  cardSummary:    document.getElementById('card-summary'),
  summaryLock:    document.getElementById('summaryLock'),
  outlineSkeleton:document.getElementById('outlineSkeleton'),
  outlineContent: document.getElementById('outlineContent'),
  outlineList:    document.getElementById('outlineList'),
  summaryInputArea: document.getElementById('summaryInputArea'),
  studentSummary: document.getElementById('studentSummary'),
  checkGrammarBtn:document.getElementById('checkGrammarBtn'),
  grammarLoader:  document.getElementById('grammarLoader'),
  correctedArea:  document.getElementById('correctedArea'),
  correctedText:  document.getElementById('correctedText'),
  acceptCorrectionBtn: document.getElementById('acceptCorrectionBtn'),

  // Section 4
  cardRecord:     document.getElementById('card-record'),
  recordLock:     document.getElementById('recordLock'),
  recordContent:  document.getElementById('recordContent'),
  teleprompter:   document.getElementById('teleprompter'),
  recordBtn:      document.getElementById('recordBtn'),
  recordAgainBtn: document.getElementById('recordAgainBtn'),
  recordingStatus:document.getElementById('recordingStatus'),
  playbackArea:   document.getElementById('playbackArea'),
  playbackAudio:  document.getElementById('playbackAudio'),

  // TTS
  ttsAudio:       document.getElementById('ttsAudio'),

  // Toast
  toastContainer: document.getElementById('toastContainer'),
};

/* ══════════════════════════════════════════════
   4.  UTILITY HELPERS
══════════════════════════════════════════════ */

/** Show/hide an element (uses hidden attribute) */
function show(el) { el.hidden = false; }
function hide(el) { el.hidden = true;  }

/** Add/remove CSS class */
function addClass(el, cls)    { el.classList.add(cls);    }
function removeClass(el, cls) { el.classList.remove(cls); }

/** Unlock a section card */
function unlockCard(card, lockEl) {
  removeClass(card, 'card-locked');
  hide(lockEl);
  addClass(card, 'reveal-enter');
}

/** Track & revoke an object URL */
function trackURL(url) {
  session.objectURLs.push(url);
  return url;
}
function revokeURL(url) {
  if (!url) return;
  URL.revokeObjectURL(url);
  session.objectURLs = session.objectURLs.filter(u => u !== url);
}

/* ── Toast Notifications ──────────────────── */
function toast(msg, type = 'info', duration = 4000) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warn: '⚠️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', 'alert');
  el.innerHTML = `<span>${icons[type] ?? 'ℹ️'}</span><span>${msg}</span>`;
  dom.toastContainer.appendChild(el);
  setTimeout(() => {
    addClass(el, 'hiding');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, duration);
}

/* ══════════════════════════════════════════════
   5.  VOICE SELECTION (on page load)
══════════════════════════════════════════════ */
function initVoice() {
  const idx = Math.floor(Math.random() * MINIMAX_VOICES.length);
  session.selectedVoice = MINIMAX_VOICES[idx];
  dom.voiceLabel.textContent = `🎙️ Voice: ${session.selectedVoice.label}`;
}

/* ══════════════════════════════════════════════
   6.  OPENAI HELPERS
══════════════════════════════════════════════ */

/**
 * Generic call to OpenAI Chat Completions.
 * @param {string} systemPrompt
 * @param {string} userContent
 * @param {boolean} jsonMode   — request JSON response
 */
async function callOpenAI(systemPrompt, userContent, jsonMode = false) {
  const body = {
    model:    OPENAI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userContent  },
    ],
    temperature: 0.4,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const resp = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errData = await resp.json().catch(() => ({}));
    throw new Error(errData?.error?.message ?? `OpenAI error ${resp.status}`);
  }

  const data = await resp.json();
  return data.choices[0].message.content.trim();
}

/* ── Prompt definitions ───────────────────── */
const PROMPT_EXPLAIN = `You are a helpful tutor. Given the article below, first write a clear, plain-language explanation of the entire article suitable for a high school student. Then identify 8-12 difficult or important words from the article and provide a simple definition for each. Return ONLY a valid JSON object with exactly two keys: "explanation" (a string) and "vocabulary" (an array of objects, each with "word" and "definition" string keys). No markdown, no code fences.`;

const PROMPT_OUTLINE = `Based on the article, create a short outline of 4-6 bullet points to help a high school student write a summary. Each point should be a concise hint. Return as plain text with each bullet on a new line starting with '-'. No extra formatting or headers.`;

const PROMPT_GRAMMAR = `Correct only grammar errors in the following student summary. Preserve the student's wording, style, and voice as much as possible. Make minimal changes only when necessary for clarity and flow. Do not rewrite the content. Return only the corrected text, nothing else.`;

/* ══════════════════════════════════════════════
   7.  MINIMAX TTS
══════════════════════════════════════════════ */

async function speakWord(word, btn) {
  // Serve from cache if available
  if (session.ttsCache[word]) {
    playAudioBlob(session.ttsCache[word]);
    return;
  }

  btn.disabled = true;
  btn.textContent = '⏳';

  try {
    const payload = {
      model: 'speech-02-hd',
      text:   word,
      stream: false,
      voice_setting: {
        voice_id:  session.selectedVoice.id,
        speed:     0.85,
        vol:       1,
        pitch:     0,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate:     128000,
        format:      'mp3',
        channel:     1,
      },
    };

    const resp = await fetch(MINIMAX_TTS_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${MINIMAX_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`MiniMax TTS error ${resp.status}: ${errText}`);
    }

    const data = await resp.json();

    // MiniMax returns audio as hex string inside data.audio
    if (data?.data?.audio) {
      const hexStr  = data.data.audio;
      const bytes   = hexToUint8Array(hexStr);
      const blob    = new Blob([bytes], { type: 'audio/mpeg' });
      const url     = trackURL(URL.createObjectURL(blob));
      session.ttsCache[word] = url;
      playAudioBlob(url);
    } else {
      throw new Error('Unexpected MiniMax response format.');
    }
  } catch (err) {
    console.error('TTS error:', err);
    toast(`Could not play audio: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔊 Listen';
  }
}

/** Convert hex string to Uint8Array */
function hexToUint8Array(hexStr) {
  const bytes = new Uint8Array(hexStr.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hexStr.substr(i * 2, 2), 16);
  }
  return bytes;
}

function playAudioBlob(url) {
  dom.ttsAudio.src = url;
  dom.ttsAudio.play().catch(e => {
    console.warn('Audio play failed:', e);
    toast('Could not play audio. Check browser permissions.', 'warn');
  });
}

/* ══════════════════════════════════════════════
   8.  ARTICLE ANALYSIS (Section 1 → 2 & 3)
══════════════════════════════════════════════ */

async function analyzeArticle() {
  const text = dom.articleText.value.trim();
  if (!text) {
    toast('Please paste or type an article first.', 'warn');
    dom.articleText.focus();
    return;
  }
  if (text.length < 100) {
    toast('Article seems too short. Please paste a longer text.', 'warn');
    return;
  }

  session.articleText = text;

  // Lock textarea & button
  dom.articleText.disabled = true;
  dom.analyzeBtn.disabled  = true;
  dom.analyzeBtn.innerHTML = '<span class="spinner"></span> Analyzing…';

  // Show global loader
  show(dom.globalLoader);

  // Unlock + skeleton both cards immediately
  unlockCard(dom.cardExplain,  dom.explainLock);
  unlockCard(dom.cardSummary,  dom.summaryLock);
  show(dom.explainSkeleton);
  show(dom.outlineSkeleton);

  try {
    const [explainRaw, outlineRaw] = await Promise.all([
      callOpenAI(PROMPT_EXPLAIN, text, true),
      callOpenAI(PROMPT_OUTLINE, text, false),
    ]);

    // ── Process explanation + vocab ──────────
    let parsed;
    try {
      parsed = JSON.parse(explainRaw);
    } catch (e) {
      // Try extracting JSON from raw text
      const match = explainRaw.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
      else throw new Error('Could not parse explanation JSON.');
    }

    session.explanation = parsed.explanation || '';
    session.vocabulary  = Array.isArray(parsed.vocabulary) ? parsed.vocabulary : [];

    renderExplanation();
    hide(dom.explainSkeleton);
    show(dom.explainContent);
    show(dom.voiceLabel);

    // ── Process outline ──────────────────────
    const lines = outlineRaw
      .split('\n')
      .map(l => l.replace(/^[-•*]\s*/, '').trim())
      .filter(l => l.length > 0);
    session.outlineHints = lines;

    renderOutline();
    hide(dom.outlineSkeleton);
    show(dom.outlineContent);
    show(dom.summaryInputArea);

    toast('Article analyzed successfully!', 'success');

  } catch (err) {
    console.error('Analysis error:', err);
    toast(`Analysis failed: ${err.message}. Please try again.`, 'error');

    // Revert UI
    dom.articleText.disabled = false;
    addClass(dom.cardExplain, 'card-locked');
    show(dom.explainLock);
    addClass(dom.cardSummary, 'card-locked');
    show(dom.summaryLock);
    hide(dom.explainSkeleton);
    hide(dom.outlineSkeleton);
  } finally {
    hide(dom.globalLoader);
    dom.analyzeBtn.disabled = false;
    dom.analyzeBtn.innerHTML = '<span class="btn-icon">🔍</span> Analyze Article';
  }
}

/* ══════════════════════════════════════════════
   9.  RENDER HELPERS
══════════════════════════════════════════════ */

function renderExplanation() {
  dom.explanationText.textContent = session.explanation;

  dom.vocabGrid.innerHTML = '';
  session.vocabulary.forEach(({ word, definition }) => {
    const card = document.createElement('div');
    card.className  = 'vocab-card';
    card.setAttribute('role', 'listitem');

    const wordEl = document.createElement('div');
    wordEl.className = 'vocab-word';
    wordEl.textContent = word;

    const defEl = document.createElement('div');
    defEl.className = 'vocab-def';
    defEl.textContent = definition;

    const actionsEl = document.createElement('div');
    actionsEl.className = 'vocab-actions';

    const listenBtn = document.createElement('button');
    listenBtn.className = 'btn-listen';
    listenBtn.textContent = '🔊 Listen';
    listenBtn.setAttribute('aria-label', `Listen to pronunciation of: ${word}`);
    listenBtn.addEventListener('click', () => speakWord(word, listenBtn));

    actionsEl.appendChild(listenBtn);
    card.append(wordEl, defEl, actionsEl);
    dom.vocabGrid.appendChild(card);
  });
}

function renderOutline() {
  dom.outlineList.innerHTML = '';
  session.outlineHints.forEach(hint => {
    const li = document.createElement('li');
    li.textContent = hint;
    dom.outlineList.appendChild(li);
  });
}

/* ══════════════════════════════════════════════
   10.  GRAMMAR CHECK (Section 3)
══════════════════════════════════════════════ */

async function checkGrammar() {
  const summary = dom.studentSummary.value.trim();
  if (!summary) {
    toast('Please write your summary first.', 'warn');
    dom.studentSummary.focus();
    return;
  }
  if (summary.split(/\s+/).length < 10) {
    toast('Your summary seems too short. Please write more.', 'warn');
    return;
  }

  dom.checkGrammarBtn.disabled = true;
  dom.checkGrammarBtn.innerHTML = '<span class="spinner"></span> Checking…';
  show(dom.grammarLoader);
  hide(dom.correctedArea);

  try {
    const corrected = await callOpenAI(PROMPT_GRAMMAR, summary, false);
    session.correctedSummary = corrected;

    dom.correctedText.textContent = corrected;
    show(dom.correctedArea);
    addClass(dom.correctedArea, 'reveal-enter');
    toast('Grammar check complete!', 'success');

    // Scroll to corrected area
    dom.correctedArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  } catch (err) {
    console.error('Grammar check error:', err);
    toast(`Grammar check failed: ${err.message}`, 'error');
  } finally {
    hide(dom.grammarLoader);
    dom.checkGrammarBtn.disabled = false;
    dom.checkGrammarBtn.innerHTML = '<span class="btn-icon">✅</span> Check Summary';
  }
}

/* ══════════════════════════════════════════════
   11.  ACCEPT CORRECTION → UNLOCK SECTION 4
══════════════════════════════════════════════ */

function acceptCorrection() {
  if (!session.correctedSummary) return;

  dom.teleprompter.textContent = session.correctedSummary;
  unlockCard(dom.cardRecord, dom.recordLock);
  show(dom.recordContent);
  addClass(dom.cardRecord, 'reveal-enter');

  dom.cardRecord.scrollIntoView({ behavior: 'smooth', block: 'start' });
  toast('Recording section unlocked! Read and record your summary.', 'success');
}

/* ══════════════════════════════════════════════
   12.  AUDIO RECORDING (Section 4)
══════════════════════════════════════════════ */

let isRecording = false;

async function toggleRecording() {
  if (isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  // Revoke previous recording if any
  if (session.recordedBlobUrl) {
    revokeURL(session.recordedBlobUrl);
    session.recordedBlobUrl = null;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });

    session.audioChunks = [];
    session.mediaRecorder = new MediaRecorder(stream, { mimeType: getSupportedMimeType() });

    session.mediaRecorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) session.audioChunks.push(e.data);
    };

    session.mediaRecorder.onstop = () => {
      // Stop all tracks to release microphone
      stream.getTracks().forEach(t => t.stop());
      finalizeRecording();
    };

    session.mediaRecorder.onerror = e => {
      console.error('MediaRecorder error:', e);
      toast('Recording error. Please try again.', 'error');
      resetRecordUI();
    };

    session.mediaRecorder.start(250); // collect data every 250ms

    isRecording = true;
    dom.recordBtn.textContent  = '';
    dom.recordBtn.innerHTML    = '<span class="record-dot"></span> Stop Recording';
    addClass(dom.recordBtn, 'recording');
    dom.recordBtn.setAttribute('aria-label', 'Stop recording');
    show(dom.recordingStatus);
    hide(dom.playbackArea);
    hide(dom.recordAgainBtn);

  } catch (err) {
    console.error('Microphone error:', err);
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      toast('Microphone permission denied. Please allow microphone access and try again.', 'error', 6000);
    } else {
      toast(`Could not start recording: ${err.message}`, 'error');
    }
  }
}

function stopRecording() {
  if (session.mediaRecorder && session.mediaRecorder.state !== 'inactive') {
    session.mediaRecorder.stop();
  }
  isRecording = false;
  resetRecordUI();
}

function finalizeRecording() {
  const mimeType = getSupportedMimeType();
  const blob     = new Blob(session.audioChunks, { type: mimeType });
  const url      = trackURL(URL.createObjectURL(blob));
  session.recordedBlobUrl  = url;
  dom.playbackAudio.src    = url;

  hide(dom.recordingStatus);
  show(dom.playbackArea);
  show(dom.recordAgainBtn);
  addClass(dom.playbackArea, 'reveal-enter');
  toast('Recording saved! Press play to listen.', 'success');
}

function resetRecordUI() {
  isRecording = false;
  removeClass(dom.recordBtn, 'recording');
  dom.recordBtn.innerHTML = '<span class="record-dot"></span> Start Recording';
  dom.recordBtn.setAttribute('aria-label', 'Start recording');
  hide(dom.recordingStatus);
}

function recordAgain() {
  if (session.recordedBlobUrl) {
    revokeURL(session.recordedBlobUrl);
    session.recordedBlobUrl = null;
  }
  dom.playbackAudio.src = '';
  hide(dom.playbackArea);
  hide(dom.recordAgainBtn);
  session.audioChunks = [];
  toast('Previous recording cleared. Ready to record again.', 'info');
}

/** Return a supported MIME type for MediaRecorder */
function getSupportedMimeType() {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return ''; // let browser choose
}

/* ══════════════════════════════════════════════
   13.  CHARACTER COUNTER
══════════════════════════════════════════════ */
function updateCharCount() {
  dom.charCount.textContent = dom.articleText.value.length.toLocaleString();
}

/* ══════════════════════════════════════════════
   14.  CLEANUP ON TAB CLOSE
══════════════════════════════════════════════ */
window.addEventListener('beforeunload', () => {
  // Revoke all object URLs
  session.objectURLs.forEach(url => URL.revokeObjectURL(url));

  // Stop any active recording
  if (session.mediaRecorder && session.mediaRecorder.state !== 'inactive') {
    try { session.mediaRecorder.stop(); } catch (_) {}
  }
});

/* ══════════════════════════════════════════════
   15.  EVENT WIRING
══════════════════════════════════════════════ */
function wireEvents() {
  // Char counter
  dom.articleText.addEventListener('input', updateCharCount);

  // Analyze button
  dom.analyzeBtn.addEventListener('click', analyzeArticle);

  // Allow Ctrl+Enter in article textarea
  dom.articleText.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') analyzeArticle();
  });

  // Grammar check
  dom.checkGrammarBtn.addEventListener('click', checkGrammar);

  // Accept correction
  dom.acceptCorrectionBtn.addEventListener('click', acceptCorrection);

  // Recording
  dom.recordBtn.addEventListener('click', toggleRecording);
  dom.recordAgainBtn.addEventListener('click', recordAgain);
}

/* ══════════════════════════════════════════════
   16.  INIT
══════════════════════════════════════════════ */
function init() {
  initVoice();
  wireEvents();
  updateCharCount();
  console.log(`%cReadSmart initialized. Voice: ${session.selectedVoice.label}`, 'color:#4f6ef7;font-weight:bold;');
}

document.addEventListener('DOMContentLoaded', init);
