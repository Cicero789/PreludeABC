/**
 * Max — speech.js
 * Practice Speech page logic
 *
 * Features:
 *  1. Enter speech → AI improves it in 3 modes: Flow, Syllable Balance, Grammar
 *  2. AI builds a structured outline tree
 *  3. TTS listen to improved speech
 *  4. Accept → teleprompter + microphone selector → record
 *  5. Playback, download, email to teacher (+ student copy), share
 */
'use strict';

/* ══════════════════════════════════════════
   CONFIG
══════════════════════════════════════════ */
const PROXY_BASE  = 'https://max-api-proxy.shanheart95.workers.dev';
const PROXY_CHAT  = `${PROXY_BASE}/api/chat`;
const PROXY_TTS   = `${PROXY_BASE}/api/tts`;
const PROXY_EMAIL = `${PROXY_BASE}/api/email`;
const PROXY_STT   = `${PROXY_BASE}/api/stt`;

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
   SESSION STATE
══════════════════════════════════════════ */
const S = {
  voice:        null,
  ttsCache:     {},
  objectURLs:   [],
  recorder:     null,
  stream:       null,
  chunks:       [],
  recBlobUrl:   null,
  recBlob:      null,
  recMime:      '',
  recording:    false,
  /* speech content */
  originalText: '',
  grammarText:  '',
  clarityText:  '',
  rhythmText:   '',
  polishText:   '',         // final rhythm-polished version
  activeTab:    'grammar',  // which improved version to use
  lastClickedTab: 'grammar', // last tab the user explicitly clicked
  recMode:      'audio', // 'audio' | 'video'
  isVideo:      false,
  /* dictation */
  dictRecorder: null,
  dictStream:   null,
  dictChunks:   [],
  dictating:    false,
};

/* ══════════════════════════════════════════
   DOM REFERENCES
══════════════════════════════════════════ */
const $   = id => document.getElementById(id);
const dom = {
  /* Step 1 */
  speechInput:    $('sp-speechInput'),
  charCount:      $('sp-charCount'),
  analyzeBtn:     $('sp-analyzeBtn'),
  globalLoader:   $('sp-globalLoader'),
  ps1: $('sp-ps1'), ps2: $('sp-ps2'), ps3: $('sp-ps3'),
  dictMicSelect:  $('sp-dictMicSelect'),
  dictMicRefresh: $('sp-dictMicRefresh'),
  dictateBtn:     $('sp-dictateBtn'),
  dictMicIcon:    $('sp-dictMicIcon'),
  dictLabel:      $('sp-dictLabel'),
  dictSpinner:    $('sp-dictSpinner'),
  dictStatus:     $('sp-dictStatus'),

  /* Step 2 */
  reviewLock:     $('sp-reviewLock'),
  twoCol:         $('sp-twoCol'),
  reviewSkeleton: $('sp-reviewSkeleton'),
  listenBtn:      $('sp-listenBtn'),
  listenLabel:    $('sp-listenLabel'),
  improvedGrammar:   $('sp-improvedGrammar'),
  improvedClarity:   $('sp-improvedClarity'),
  improvedRhythm:    $('sp-improvedRhythm'),
  outlineTree:    $('sp-outlineTree'),
  acceptBtn:      $('sp-acceptBtn'),

  /* Step 3 — Polish */
  polishLock:          $('sp-polishLock'),
  polishContent:       $('sp-polishContent'),
  polishLoader:        $('sp-polishLoader'),
  polishSourceLabel:   $('sp-polishSourceLabel'),
  polishGrammarText:   $('sp-polishGrammarText'),
  polishText:          $('sp-polishText'),
  usePolishedBtn:      $('sp-usePolishedBtn'),

  /* Step 4 — Record */
  recordLock:     $('sp-recordLock'),
  recordContent:  $('sp-recordContent'),
  teleprompter:   $('sp-teleprompter'),
  recModeRow:     $('sp-recModeRow'),
  modeAudioBtn:   $('sp-modeAudioBtn'),
  modeVideoBtn:   $('sp-modeVideoBtn'),
  micSelectRow:   $('sp-micSelectRow'),
  micSelect:      $('sp-micSelect'),
  micRefreshBtn:  $('sp-micRefreshBtn'),
  camSelectRow:   $('sp-camSelectRow'),
  camSelect:      $('sp-camSelect'),
  camRefreshBtn:  $('sp-camRefreshBtn'),
  cameraPreview:  $('sp-cameraPreview'),
  previewVideo:   $('sp-previewVideo'),
  recordBtn:      $('sp-recordBtn'),
  recordBtnLabel: $('sp-recordBtnLabel'),
  recordAgainBtn: $('sp-recordAgainBtn'),
  recordingStatus:$('sp-recordingStatus'),
  playbackArea:   $('sp-playbackArea'),
  audioPlaybackWrap: $('sp-audioPlaybackWrap'),
  videoPlaybackWrap: $('sp-videoPlaybackWrap'),
  playbackAudio:  $('sp-playbackAudio'),
  playbackVideo:  $('sp-playbackVideo'),
  downloadBtn:    $('sp-downloadBtn'),
  emailSubmitBtn: $('sp-emailSubmitBtn'),
  emailLoader:    $('sp-emailLoader'),
  shareBtn:       $('sp-shareBtn'),
  emailSuccess:   $('sp-emailSuccess'),
  studentName:    $('sp-studentName'),
  studentEmail:   $('sp-studentEmail'),
  submitBlock:    $('sp-submitBlock'),
  videoNotice:    $('sp-videoNotice'),

  /* Header steps */
  hstep1: $('sp-hstep1'),
  hstep2: $('sp-hstep2'),
  hstep3: $('sp-hstep3'),
  hstep4: $('sp-hstep4'),

  /* Toast / TTS */
  toastContainer: $('sp-toastContainer'),
  ttsAudio:       $('sp-ttsAudio'),
};

/* ══════════════════════════════════════════
   HELPERS
══════════════════════════════════════════ */
function show(el) { if (el) el.hidden = false; }
function hide(el) { if (el) el.hidden = true; }

function toast(msg, type = 'info', duration = 3500) {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  dom.toastContainer.appendChild(t);
  requestAnimationFrame(() => t.classList.add('toast-show'));
  setTimeout(() => {
    t.classList.remove('toast-show');
    setTimeout(() => t.remove(), 350);
  }, duration);
}

function setHeaderStep(n) {
  [dom.hstep1, dom.hstep2, dom.hstep3, dom.hstep4].forEach((el, i) => {
    if (!el) return;
    el.classList.toggle('active',   i + 1 === n);
    el.classList.toggle('complete', i + 1 < n);
  });
}

async function fetchWithTimeout(url, opts = {}, ms = 55000) {
  const ctrl = new AbortController();
  const tid   = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
}

/* Pick a random voice once per session */
function initVoice() {
  S.voice = VOICES[Math.floor(Math.random() * VOICES.length)];
}

/* ══════════════════════════════════════════
   AI CALLS
══════════════════════════════════════════ */
async function callAI(systemPrompt, userContent) {
  const resp = await fetchWithTimeout(PROXY_CHAT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system',  content: systemPrompt },
        { role: 'user',    content: userContent  },
      ],
      temperature: 0.4,
    }),
  });
  if (!resp.ok) throw new Error(`AI error ${resp.status}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

/* ─── Shared base — Rhetoric Refiner / Strunk & White / MLA ─── */
const SPEECH_CORE = [
  'You are a disciplined writing assistant following "The Elements of Style" by Strunk and White',
  'and MLA citation standards.',
  '',
  'RULES that apply to ALL versions:',
  '- Deliver rewrites that are straightforward, sincere, and keep to the original text with MINIMAL changes.',
  '- Use vocabulary common to books, magazines, and newspapers. Avoid rare or ornate words.',
  '- Target the same reading level as the input text.',
  '- Steer clear of unnecessary adjectives, fancy adjectives, and redundant phrases.',
  '- Maintain a respectful, non-patronizing tone.',
  '- Keep all verb tenses consistent throughout the text.',
  '- DO NOT change, correct, or alter any text inside quotation marks. Leave quoted material exactly as written.',
  '- DO NOT use em dashes (\u2014). Use commas, semicolons, or recast the sentence instead.',
  '- Assume all paragraphs are from the same document in chronological order. Make transitions as necessary.',
  '- Do not eliminate important elements of the original writing.',
  '- Adhere to MLA citation standards for any references.',
  '- Output ONLY the rewritten text. No headings, labels, or markdown.',
].join('\n');

/* Version 1: Grammar corrections only */
const PROMPT_GRAMMAR = SPEECH_CORE + '\n\n' +
  'TASK \u2014 Grammar version:\n' +
  '- Correct ONLY grammatical errors: subject-verb agreement, tense consistency, article usage,\n' +
  '  pronoun reference, punctuation, and spelling.\n' +
  '- Do NOT rewrite or restructure any sentence beyond what fixing the grammar requires.\n' +
  '- Do NOT improve style, word choice, sentence flow, or transitions.\n' +
  "- Preserve the student's own voice, sentence patterns, and phrasing exactly.\n" +
  '- Output ONLY the grammar-corrected text.';

/* Version 2: Enhanced Clarity */
const PROMPT_CLARITY = SPEECH_CORE + '\n\n' +
  'TASK \u2014 Enhanced Clarity version:\n' +
  '- Correct all grammar errors (same as Grammar version).\n' +
  '- Additionally improve CLARITY and LOGICAL FLOW with minimal changes:\n' +
  '  * Aim for clarity and logical flow while targeting the same reading level as the input.\n' +
  '  * Replace convoluted or ambiguous phrasing with clear, direct language.\n' +
  '  * Remove redundant phrases, unnecessary filler words, and unnecessary adjectives.\n' +
  '  * Improve transitions between sentences and ideas where needed.\n' +
  '  * Do NOT add new content or change the overall meaning.\n' +
  '- Output ONLY the enhanced-clarity text.';

/* Version 3: Enhanced Rhythm */
const PROMPT_RHYTHM = SPEECH_CORE + '\n\n' +
  'TASK \u2014 Enhanced Rhythm version:\n' +
  '- Correct all grammar errors (same as Grammar version).\n' +
  '- Additionally improve RHYTHM and SYLLABLE BALANCE for spoken delivery:\n' +
  '  * Vary sentence length so short punchy sentences alternate with longer flowing ones.\n' +
  '  * Replace heavy multi-syllable words with simpler common equivalents where meaning is preserved.\n' +
  '  * Improve the natural spoken cadence and flow of the speech.\n' +
  '  * Do NOT add new content or change the overall meaning.\n' +
  '- Output ONLY the rhythm-enhanced text. Do NOT annotate words with syllable counts.';

/* Version 4: Final Polish — light flow improvement only, minimal changes */
const PROMPT_FINAL_POLISH = [
  'You are a careful editor. Your only job is to improve the natural flow of the speech for spoken delivery.',
  '',
  'STRICT RULES — read carefully:',
  '- Make the SMALLEST possible changes needed to improve spoken flow.',
  '- Fix only what makes the speech awkward or halting when read aloud.',
  '- You may smooth transitions between sentences where they feel abrupt.',
  '- You may lightly adjust punctuation (commas, periods) to improve spoken pacing.',
  '- Do NOT rewrite sentences. Do NOT restructure paragraphs.',
  '- Do NOT replace the student\'s words with synonyms or "better" words.',
  '- Do NOT change meaning, tone, or any important content.',
  '- Do NOT add new ideas, examples, or sentences.',
  '- Do NOT remove any content the student wrote.',
  '- Do NOT change, correct, or alter any text inside quotation marks.',
  '- Do NOT use em dashes (—).',
  '- Keep all verb tenses as they are.',
  '- The output must be recognisably the same speech — a reader should see only minor, targeted edits.',
  '- Output ONLY the lightly edited speech text. No labels, headings, or markdown.',
].join('\n');

const PROMPT_OUTLINE = [
  'You are a speech coach. Create a structured outline for this speech.',
  'Format as a JSON array with this structure:',
  '[',
  '  {',
  '    "title": "Introduction",',
  '    "points": [',
  '      { "text": "Opening hook", "sub": [] },',
  '      { "text": "Thesis statement", "sub": ["Key point preview"] }',
  '    ]',
  '  },',
  '  {',
  '    "title": "Main Body",',
  '    "points": [',
  '      { "text": "First main argument", "sub": ["Supporting detail 1", "Supporting detail 2"] }',
  '    ]',
  '  },',
  '  {',
  '    "title": "Conclusion",',
  '    "points": [',
  '      { "text": "Summary of key points", "sub": [] },',
  '      { "text": "Call to action or closing", "sub": [] }',
  '    ]',
  '  }',
  ']',
  'Output ONLY valid JSON, no explanation or markdown fences.',
].join('\n');

/* ══════════════════════════════════════════
   PROGRESS ANIMATION
══════════════════════════════════════════ */
let _progressTimer = null;
function startProgress() {
  show(dom.globalLoader);
  const steps = [dom.ps1, dom.ps2, dom.ps3];
  let i = 0;
  steps.forEach(s => s && s.classList.remove('active', 'done'));
  steps[0] && steps[0].classList.add('active');
  _progressTimer = setInterval(() => {
    if (i < steps.length - 1) {
      steps[i].classList.remove('active');
      steps[i].classList.add('done');
      i++;
      steps[i].classList.add('active');
    }
  }, 3500);
}
function stopProgress() {
  clearInterval(_progressTimer);
  hide(dom.globalLoader);
  [dom.ps1, dom.ps2, dom.ps3].forEach(s => s && s.classList.remove('active', 'done'));
  dom.ps1 && dom.ps1.classList.add('active');
}

/* ══════════════════════════════════════════
   SYLLABLE RENDERING
══════════════════════════════════════════ */
/**
 * Convert AI-annotated text like "Good[1] morning[2] everyone[4]"
 * into coloured HTML spans.
 */
function renderSyllableText(raw) {
  // Replace word[N] patterns with coloured spans
  return raw.replace(/(\S+?)\[(\d+)\]/g, (_, word, n) => {
    const num = parseInt(n, 10);
    const cls = num === 1 ? 'syl-1'
              : num === 2 ? 'syl-2'
              : num === 3 ? 'syl-3'
              :              'syl-4';
    return `<span class="syl-word ${cls}" title="${n} syllable${num !== 1 ? 's' : ''}">${word}</span>`;
  });
}

/* ══════════════════════════════════════════
   OUTLINE TREE RENDERING
══════════════════════════════════════════ */
function renderOutlineTree(jsonText) {
  let sections;
  try {
    // Strip any accidental markdown fences
    const clean = jsonText.replace(/```json|```/g, '').trim();
    sections = JSON.parse(clean);
  } catch {
    dom.outlineTree.innerHTML = `<p class="sp-outline-error">Could not parse outline.</p>`;
    return;
  }
  if (!Array.isArray(sections)) { dom.outlineTree.innerHTML = ''; return; }

  const ul = document.createElement('ul');
  ul.className = 'sp-outline-root';

  sections.forEach(section => {
    const sectionLi = document.createElement('li');
    sectionLi.className = 'sp-outline-section';

    const sectionTitle = document.createElement('div');
    sectionTitle.className = 'sp-outline-section-title';
    sectionTitle.textContent = section.title || '';
    sectionLi.appendChild(sectionTitle);

    if (Array.isArray(section.points) && section.points.length) {
      const pointsUl = document.createElement('ul');
      pointsUl.className = 'sp-outline-points';

      section.points.forEach(point => {
        const pointLi = document.createElement('li');
        pointLi.className = 'sp-outline-point';

        const bullet = document.createElement('span');
        bullet.className = 'sp-outline-bullet';
        bullet.textContent = '▸';
        pointLi.appendChild(bullet);

        const pointText = document.createElement('span');
        pointText.className = 'sp-outline-point-text';
        pointText.textContent = point.text || '';
        pointLi.appendChild(pointText);

        // Sub-points
        if (Array.isArray(point.sub) && point.sub.length) {
          const subUl = document.createElement('ul');
          subUl.className = 'sp-outline-subs';
          point.sub.forEach(subText => {
            const subLi = document.createElement('li');
            subLi.className = 'sp-outline-sub';
            subLi.innerHTML = `<span class="sp-outline-sub-dot">·</span> ${subText}`;
            subUl.appendChild(subLi);
          });
          pointLi.appendChild(subUl);
        }

        pointsUl.appendChild(pointLi);
      });
      sectionLi.appendChild(pointsUl);
    }

    ul.appendChild(sectionLi);
  });

  dom.outlineTree.innerHTML = '';
  dom.outlineTree.appendChild(ul);
}

/* ══════════════════════════════════════════
   DICTATION  (Whisper STT)
   Records from the selected mic, sends audio
   to /api/stt, then inserts the transcript at
   the current cursor position in the textarea.
══════════════════════════════════════════ */
async function populateDictMicList() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
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
  /* pulse mic icon red while recording */
  dom.dictMicIcon.style.stroke = isRecording ? '#ef4444' : '';
}

async function toggleDictation() {
  if (S.dictating) {
    /* ── STOP ── */
    if (S.dictRecorder && S.dictRecorder.state !== 'inactive') S.dictRecorder.stop();
    return;
  }

  /* ── START ── */
  S.dictating  = true;
  S.dictChunks = [];

  const deviceId = dom.dictMicSelect.value;
  const constraints = { audio: deviceId ? { deviceId: { exact: deviceId } } : true };

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    /* Re-populate mic list now that we have labels */
    populateDictMicList();
  } catch (e) {
    S.dictating = false;
    toast('Microphone access denied.', 'error');
    return;
  }

  S.dictStream = stream;

  /* Pick best MIME type */
  const mime = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4']
    .find(t => MediaRecorder.isTypeSupported(t)) || '';

  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
  S.dictRecorder = recorder;

  recorder.ondataavailable = e => { if (e.data?.size > 0) S.dictChunks.push(e.data); };

  recorder.onstop = async () => {
    /* Stop tracks */
    stream.getTracks().forEach(t => t.stop());
    S.dictStream = null;
    S.dictating  = false;
    setDictStatus('', false);

    if (!S.dictChunks.length) return;

    /* Show processing state */
    dom.dictateBtn.disabled = true;
    show(dom.dictSpinner);
    dom.dictLabel.textContent = 'Transcribing…';

    try {
      const blob     = new Blob(S.dictChunks, { type: recorder.mimeType || 'audio/webm' });
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

      /* Insert at cursor (or append) */
      const ta    = dom.speechInput;
      const start = ta.selectionStart ?? ta.value.length;
      const end   = ta.selectionEnd   ?? ta.value.length;
      const before = ta.value.slice(0, start);
      const after  = ta.value.slice(end);
      /* Add a space before if needed */
      const spacer = (before.length && !before.endsWith(' ') && !before.endsWith('\n')) ? ' ' : '';
      ta.value = before + spacer + transcript + after;
      /* Move cursor to end of inserted text */
      const newPos = start + spacer.length + transcript.length;
      ta.setSelectionRange(newPos, newPos);
      ta.focus();
      /* Update char count */
      dom.charCount.textContent = ta.value.length;
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
   MAIN ANALYSIS FLOW
══════════════════════════════════════════ */
async function analyzeSpeech() {
  const text = dom.speechInput.value.trim();
  if (!text || text.length < 20) {
    toast('Please enter your speech first (at least a few sentences).', 'warn');
    return;
  }

  dom.analyzeBtn.disabled = true;
  startProgress();

  // Show skeleton on card 2
  const cardReview = $('sp-card-review');
  if (cardReview) cardReview.classList.remove('card-locked');
  show(dom.reviewSkeleton);
  hide(dom.reviewLock);
  hide(dom.twoCol);

  try {
    S.originalText = text;

    // Run all 4 AI calls in parallel for speed
    const [grammarResult, clarityResult, rhythmResult, outlineResult] = await Promise.all([
      callAI(PROMPT_GRAMMAR,  text),
      callAI(PROMPT_CLARITY,  text),
      callAI(PROMPT_RHYTHM,   text),
      callAI(PROMPT_OUTLINE,  text),
    ]);

    S.grammarText  = grammarResult;
    S.clarityText  = clarityResult;
    S.rhythmText   = rhythmResult;

    // Render left panel (all three tab versions)
    dom.improvedGrammar.textContent   = grammarResult;
    dom.improvedClarity.textContent   = clarityResult;
    dom.improvedRhythm.textContent    = rhythmResult;

    // Render right panel outline
    renderOutlineTree(outlineResult);

    // Show the two-column layout
    hide(dom.reviewSkeleton);
    show(dom.twoCol);

    setHeaderStep(2);
    toast('Speech analyzed! Review improvements below.', 'success');

    // Scroll to card 2
    cardReview.scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (e) {
    toast(`Analysis failed: ${e.message}`, 'error', 5000);
    hide(dom.reviewSkeleton);
    show(dom.reviewLock);
    if (cardReview) cardReview.classList.add('card-locked');
  } finally {
    dom.analyzeBtn.disabled = false;
    stopProgress();
  }
}

/* ══════════════════════════════════════════
   TAB SWITCHING
══════════════════════════════════════════ */
function switchTab(tabId) {
  document.querySelectorAll('.sp-tab').forEach(btn => {
    const active = btn.dataset.tab === tabId;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.sp-tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `sp-panel-${tabId}`);
  });
  S.activeTab = tabId;
  S.lastClickedTab = tabId; // track the user's explicit choice
}

/* ══════════════════════════════════════════
   TTS — LISTEN TO IMPROVED SPEECH
══════════════════════════════════════════ */
async function listenToSpeech() {
  const textMap = { grammar: S.grammarText, clarity: S.clarityText, rhythm: S.rhythmText };
  let text = textMap[S.activeTab] || S.grammarText;

  if (!text) { toast('Nothing to listen to yet.', 'warn'); return; }

  // Check cache
  const cacheKey = `${S.activeTab}:${text.slice(0, 40)}`;
  if (S.ttsCache[cacheKey]) {
    dom.ttsAudio.src = S.ttsCache[cacheKey];
    dom.ttsAudio.play();
    return;
  }

  dom.listenLabel.textContent = 'Loading…';
  dom.listenBtn.disabled = true;

  try {
    const resp = await fetchWithTimeout(PROXY_TTS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voice_id: S.voice?.id || 'presenter_male',
        speed: 1.0,
      }),
    }, 30000);

    if (!resp.ok) throw new Error(`TTS error ${resp.status}`);
    const data = await resp.json();
    const b64 = data?.data?.audio || data?.audio || '';
    if (!b64) throw new Error('No audio in TTS response');

    const binary = atob(b64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob   = new Blob([bytes], { type: 'audio/mpeg' });
    const url    = URL.createObjectURL(blob);
    S.objectURLs.push(url);
    S.ttsCache[cacheKey] = url;

    dom.ttsAudio.src = url;
    await dom.ttsAudio.play();

  } catch (e) {
    // Fallback to browser speech synthesis
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate  = 0.95;
    speechSynthesis.speak(utter);
    toast('Using browser voice (TTS service unavailable).', 'info');
  } finally {
    dom.listenLabel.textContent = 'Listen';
    dom.listenBtn.disabled = false;
  }
}

/* ══════════════════════════════════════════
   ACCEPT → UNLOCK RECORDING
══════════════════════════════════════════ */
function getActiveText() {
  return (S.activeTab === 'clarity' ? S.clarityText
        : S.activeTab === 'rhythm' ? S.rhythmText
        : S.grammarText) || S.grammarText;
}

/* ══════════════════════════════════════════
   STEP 2 → STEP 3: POLISH (use last-clicked tab, run spoken-delivery AI pass)
══════════════════════════════════════════ */
async function polishSpeech() {
  if (!S.grammarText) { toast('No improved speech to polish yet.', 'warn'); return; }

  // Use whichever version the user last clicked; default to activeTab
  const tabId   = S.lastClickedTab || S.activeTab || 'grammar';
  const textMap = { grammar: S.grammarText, clarity: S.clarityText, rhythm: S.rhythmText };
  const sourceText = textMap[tabId] || S.grammarText;
  const labelMap = {
    grammar: 'Grammar Corrected',
    clarity: 'Enhanced Clarity',
    rhythm:  'Enhanced Rhythm',
  };
  const sourceLabel = labelMap[tabId] || 'Grammar Corrected';

  // Unlock Step 3 card and show loader
  const cardPolish = $('sp-card-polish');
  if (cardPolish) cardPolish.classList.remove('card-locked');
  hide(dom.polishLock);
  show(dom.polishLoader);
  hide(dom.polishContent);
  dom.acceptBtn.disabled = true;

  // Update Step 3 "based on" label
  if (dom.polishSourceLabel) dom.polishSourceLabel.textContent = sourceLabel;

  setHeaderStep(3);
  cardPolish.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    // Run spoken-delivery polish on the user's chosen version
    const polished = await callAI(PROMPT_FINAL_POLISH, sourceText);
    S.polishText = polished;
    dom.polishText.textContent = polished;

    hide(dom.polishLoader);
    show(dom.polishContent);
    toast(`Step 3 ready! Polished from your "${sourceLabel}" version.`, 'success');
  } catch (e) {
    toast(`Polish failed: ${e.message}`, 'error', 5000);
    hide(dom.polishLoader);
    show(dom.polishLock);
    if (cardPolish) cardPolish.classList.add('card-locked');
  } finally {
    dom.acceptBtn.disabled = false;
  }
}

/* ══════════════════════════════════════════
   STEP 3 → STEP 4: USE POLISHED FOR RECORDING
══════════════════════════════════════════ */
function usePolished() {
  const text = S.polishText;
  if (!text) { toast('No polished speech yet.', 'warn'); return; }

  // Populate teleprompter with the final polished version
  dom.teleprompter.textContent = text;

  // Unlock Step 4
  const cardRecord = $('sp-card-record');
  if (cardRecord) cardRecord.classList.remove('card-locked');
  hide(dom.recordLock);
  show(dom.recordContent);

  setHeaderStep(4);

  // Populate device lists
  populateMicList();

  toast('Speech ready! Now record your delivery.', 'success');
  cardRecord.scrollIntoView({ behavior: 'smooth', block: 'start' });
}


/* ══════════════════════════════════════════
   MICROPHONE SELECTOR
══════════════════════════════════════════ */
/* ── Populate microphone dropdown ─────────────── */
async function populateMicList() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    populateDeviceSelect(dom.micSelect, devices.filter(d => d.kind === 'audioinput'),
      'Default microphone', 'Microphone', 'Grant microphone permission to see names');
  } catch (_) { /* silent */ }
}

/* ── Populate camera dropdown ─────────────────── */
async function populateCamList() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    populateDeviceSelect(dom.camSelect, devices.filter(d => d.kind === 'videoinput'),
      'Default camera', 'Camera', 'Grant camera permission to see names');
  } catch (_) { /* silent */ }
}

/* ── Generic device <select> filler ──────────────
 * Keeps current selection if still available.  */
function populateDeviceSelect(selectEl, devices, defaultLabel, genericLabel, permHint) {
  const prevVal = selectEl.value;
  selectEl.innerHTML = '';
  const def = document.createElement('option');
  def.value = '';
  def.textContent = defaultLabel;
  selectEl.appendChild(def);
  devices.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `${genericLabel} (${d.deviceId.slice(0, 8)}…)`;
    selectEl.appendChild(opt);
  });
  if (prevVal && [...selectEl.options].some(o => o.value === prevVal))
    selectEl.value = prevVal;
  const allBlank = devices.every(d => !d.label);
  if (allBlank && devices.length > 0) {
    const hint = document.createElement('option');
    hint.disabled = true;
    hint.textContent = `↑ ${permHint}`;
    selectEl.appendChild(hint);
  }
}

/* ── Recording mode switch ────────────────────── */
function setRecordingMode(mode) {
  S.recMode = mode;
  S.isVideo = (mode === 'video');
  dom.modeAudioBtn.classList.toggle('active', !S.isVideo);
  dom.modeVideoBtn.classList.toggle('active',  S.isVideo);
  dom.modeAudioBtn.setAttribute('aria-pressed', !S.isVideo ? 'true' : 'false');
  dom.modeVideoBtn.setAttribute('aria-pressed',  S.isVideo ? 'true' : 'false');
  // Show/hide camera selector
  if (S.isVideo) {
    show(dom.camSelectRow);
    populateCamList();
    // Video mode: hide email/share block, show download-only notice
    hide(dom.submitBlock);
    show(dom.videoNotice);
  } else {
    hide(dom.camSelectRow);
    hide(dom.cameraPreview);
    if (dom.previewVideo.srcObject) {
      dom.previewVideo.srcObject.getTracks().forEach(t => t.stop());
      dom.previewVideo.srcObject = null;
    }
    // Audio mode: show email/share block, hide video notice
    show(dom.submitBlock);
    hide(dom.videoNotice);
  }
}

/* ══════════════════════════════════════════
   RECORDING (audio-only or video+audio)
══════════════════════════════════════════ */
async function startRecording() {
  const micId = dom.micSelect.value;
  const camId = dom.camSelect.value;

  // Build media constraints
  const audioConstraints = {
    echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    ...(micId ? { deviceId: { exact: micId } } : {}),
  };
  const videoConstraints = S.isVideo
    ? { width: { ideal: 1280 }, height: { ideal: 720 }, ...(camId ? { deviceId: { exact: camId } } : {}) }
    : false;

  // Request media access
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      ...(videoConstraints ? { video: videoConstraints } : {}),
    });
  } catch (e) {
    if (e.name === 'OverconstrainedError') {
      toast('Selected device unavailable — falling back to defaults.', 'warn');
      try {
        S.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          ...(S.isVideo ? { video: true } : {}),
        });
      } catch (e2) {
        toast(`Microphone/camera error: ${e2.message}`, 'error'); return;
      }
    } else {
      toast(`Microphone/camera error: ${e.message}`, 'error'); return;
    }
  }

  // Refresh device lists with real labels now that permission is granted
  populateMicList();
  if (S.isVideo) {
    populateCamList();
    // Show live camera preview
    dom.previewVideo.srcObject = S.stream;
    show(dom.cameraPreview);
  }

  // Pick best supported MIME for mode
  const audioMimes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  const videoMimes = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  const mimeList   = S.isVideo ? videoMimes : audioMimes;
  const mime = mimeList.find(m => MediaRecorder.isTypeSupported(m)) || '';

  S.chunks  = [];
  S.isVideo = !!(S.stream.getVideoTracks().length > 0); // reconfirm
  S.recMime = mime || (S.isVideo ? 'video/webm' : 'audio/webm');
  S.recorder = new MediaRecorder(S.stream, mime ? { mimeType: mime } : {});

  S.recorder.ondataavailable = e => { if (e.data.size > 0) S.chunks.push(e.data); };

  S.recorder.onstop = () => {
    // Stop preview and all tracks
    if (dom.previewVideo.srcObject) {
      dom.previewVideo.srcObject.getTracks().forEach(t => t.stop());
      dom.previewVideo.srcObject = null;
    }
    hide(dom.cameraPreview);
    if (S.stream) { S.stream.getTracks().forEach(t => t.stop()); S.stream = null; }

    const blob = new Blob(S.chunks, { type: S.recMime });
    S.recBlob    = blob;
    if (S.recBlobUrl) URL.revokeObjectURL(S.recBlobUrl);
    S.recBlobUrl = URL.createObjectURL(blob);
    S.objectURLs.push(S.recBlobUrl);

    // Show the right player
    if (S.isVideo) {
      dom.playbackVideo.src = S.recBlobUrl;
      show(dom.videoPlaybackWrap);
      hide(dom.audioPlaybackWrap);
    } else {
      dom.playbackAudio.src = S.recBlobUrl;
      show(dom.audioPlaybackWrap);
      hide(dom.videoPlaybackWrap);
    }

    show(dom.playbackArea);
    hide(dom.recordingStatus);
    show(dom.recordAgainBtn);
    dom.recordBtnLabel.textContent = 'Start Recording';
    dom.recordBtn.classList.remove('recording');
    S.recording = false;

    toast(`${S.isVideo ? 'Video' : 'Audio'} recording saved! Review below.`, 'success');
  };

  S.recorder.start(250);
  S.recording = true;
  dom.recordBtnLabel.textContent = 'Stop Recording';
  dom.recordBtn.classList.add('recording');
  hide(dom.recordAgainBtn);
  hide(dom.playbackArea);
  show(dom.recordingStatus);
}

function stopRecording() {
  if (S.recorder && S.recorder.state !== 'inactive') {
    S.recorder.stop();
  }
}

function toggleRecording() {
  if (!S.recording) startRecording();
  else               stopRecording();
}

function recordAgain() {
  if (S.recBlobUrl) { URL.revokeObjectURL(S.recBlobUrl); S.recBlobUrl = null; }
  S.recBlob = null;
  hide(dom.playbackArea);
  hide(dom.recordingStatus);
  hide(dom.recordAgainBtn);
  hide(dom.emailSuccess);
  dom.recordBtnLabel.textContent = 'Start Recording';
  dom.recordBtn.classList.remove('recording');
}

/* ══════════════════════════════════════════
   DOWNLOAD
══════════════════════════════════════════ */
function downloadRecording() {
  if (!S.recBlobUrl) { toast('Nothing to download yet.', 'warn'); return; }
  const isVid = S.isVideo && S.recMime.startsWith('video/');
  const ext   = isVid
    ? (S.recMime.includes('mp4') ? 'mp4' : 'webm')
    : (S.recMime.includes('mp4') || S.recMime.includes('m4a') ? 'm4a'
       : S.recMime.includes('ogg') ? 'ogg' : 'webm');
  const name  = dom.studentName.value.trim().replace(/\s+/g, '-').toLowerCase() || 'speech';
  const a     = document.createElement('a');
  a.href      = S.recBlobUrl;
  a.download  = `speech-${name}.${ext}`;
  a.click();
}

/* ══════════════════════════════════════════
   EMAIL TO TEACHER
══════════════════════════════════════════ */
async function emailRecording() {
  const name    = dom.studentName.value.trim();
  const email   = dom.studentEmail.value.trim();

  if (!name) { toast('Please enter your name before sending.', 'warn'); return; }
  if (!S.recBlob) { toast('No recording to send yet.', 'warn'); return; }

  hide(dom.emailSuccess);
  show(dom.emailLoader);
  dom.emailSubmitBtn.disabled = true;

  try {
    /* Convert blob to base64 */
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(S.recBlob);
    });

    const resp = await fetchWithTimeout(PROXY_EMAIL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentName:    name,
        studentEmail:   email,
        audioBase64:    base64,
        audioMime:      S.recMime,
        articleTitle:   'Practice Speech',
        speechMode:     'speech',
        writtenSpeech:  S.originalText || dom.speechInput.value.trim() || '',
        speechText:     S.polishText || dom.teleprompter.textContent.trim() || '',
        clientTime:     new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long' }),
        clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      }),
    }, 30000);

    const result = await resp.json().catch(() => ({}));

    if (result.ok) {
      show(dom.emailSuccess);
      toast('Recording sent to your teacher!', 'success');
    } else {
      throw new Error(result.error || `HTTP ${resp.status}`);
    }
  } catch (e) {
    toast(`Could not send email: ${e.message}`, 'error', 5000);
  } finally {
    hide(dom.emailLoader);
    dom.emailSubmitBtn.disabled = false;
  }
}

/* ══════════════════════════════════════════
   SHARE (Web Share API)
══════════════════════════════════════════ */
async function shareRecording() {
  if (!S.recBlob) { toast('No recording to share yet.', 'warn'); return; }

  const isVid = S.isVideo && S.recMime.startsWith('video/');
  const ext   = isVid
    ? (S.recMime.includes('mp4') ? 'mp4' : 'webm')
    : (S.recMime.includes('mp4') || S.recMime.includes('m4a') ? 'm4a'
       : S.recMime.includes('ogg') ? 'ogg' : 'webm');
  const name  = dom.studentName.value.trim().replace(/\s+/g, '-').toLowerCase() || 'speech';
  const file  = new File([S.recBlob], `speech-${name}.${ext}`, { type: S.recMime });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        title: `My Practice Speech${isVid ? ' (Video)' : ''}`,
        text:  `${dom.studentName.value.trim() || 'Student'}'s practice speech recording`,
        files: [file],
      });
    } catch (e) {
      if (e.name !== 'AbortError') toast(`Share failed: ${e.message}`, 'error');
    }
  } else {
    toast('Sharing not supported on this browser — use Download instead.', 'info', 4000);
  }
}

/* ══════════════════════════════════════════
   CLEANUP ON TAB CLOSE
══════════════════════════════════════════ */
function cleanup() {
  S.objectURLs.forEach(u => URL.revokeObjectURL(u));
  if (S.stream) S.stream.getTracks().forEach(t => t.stop());
  if (S.dictStream) S.dictStream.getTracks().forEach(t => t.stop());
  if (S.dictRecorder && S.dictRecorder.state !== 'inactive') S.dictRecorder.stop();
  if (dom.previewVideo && dom.previewVideo.srcObject) {
    dom.previewVideo.srcObject.getTracks().forEach(t => t.stop());
    dom.previewVideo.srcObject = null;
  }
}

/* ══════════════════════════════════════════
   EVENT LISTENERS
══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initVoice();

  /* Char counter */
  dom.speechInput.addEventListener('input', () => {
    dom.charCount.textContent = dom.speechInput.value.length.toLocaleString();
  });

  /* Ctrl + Enter shortcut */
  dom.speechInput.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 'Enter') analyzeSpeech();
  });

  /* Analyze button */
  dom.analyzeBtn.addEventListener('click', analyzeSpeech);

  /* Clear speech text */
  const clearSpeechBtn = document.getElementById('sp-clearBtn');
  if (clearSpeechBtn) {
    clearSpeechBtn.addEventListener('click', () => {
      dom.speechInput.value = '';
      dom.charCount.textContent = '0';
      dom.speechInput.focus();
    });
  }

  /* Dictation mic refresh */
  dom.dictMicRefresh.addEventListener('click', populateDictMicList);

  /* Dictate toggle button */
  dom.dictateBtn.addEventListener('click', toggleDictation);

  /* Pre-populate dictation mic list */
  populateDictMicList();

  /* Tab switching */
  document.querySelectorAll('.sp-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  /* Listen button */
  dom.listenBtn.addEventListener('click', listenToSpeech);

  /* Accept / Polish button (Step 2 → Step 3) */
  dom.acceptBtn.addEventListener('click', polishSpeech);

  /* Use Polished button (Step 3 → Step 4) */
  if (dom.usePolishedBtn) dom.usePolishedBtn.addEventListener('click', usePolished);

  /* Microphone refresh */
  dom.micRefreshBtn.addEventListener('click', populateMicList);

  /* Camera refresh */
  dom.camRefreshBtn.addEventListener('click', populateCamList);

  /* Device change listener (refreshes both lists) */
  navigator.mediaDevices?.addEventListener('devicechange', () => {
    populateMicList();
    if (S.isVideo) populateCamList();
  });

  /* Recording mode toggle */
  dom.modeAudioBtn.addEventListener('click', () => setRecordingMode('audio'));
  dom.modeVideoBtn.addEventListener('click', () => setRecordingMode('video'));

  /* Record toggle */
  dom.recordBtn.addEventListener('click', toggleRecording);

  /* Record again */
  dom.recordAgainBtn.addEventListener('click', recordAgain);

  /* Download */
  dom.downloadBtn.addEventListener('click', downloadRecording);

  /* Email */
  dom.emailSubmitBtn.addEventListener('click', emailRecording);

  /* Share */
  dom.shareBtn.addEventListener('click', shareRecording);

  /* Cleanup */
  window.addEventListener('pagehide', cleanup);
  window.addEventListener('beforeunload', cleanup);
});
