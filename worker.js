/**
 * Max — Cloudflare Worker API Proxy  (worker.js)
 *
 * Routes:
 *   POST /api/chat        → Cloudflare Workers AI (chat completions)
 *   POST /api/tts         → MiniMax /v1/t2a_v2
 *   POST /api/stt         → Cloudflare Workers AI (Whisper STT)
 *   POST /api/email       → Mailgun /v3/{domain}/messages  (raw multipart body)
 *   GET  /api/health      → status check
 *   OPTIONS *             → CORS pre-flight
 *
 * Bindings (wrangler-proxy.jsonc):
 *   AI  – Cloudflare Workers AI binding (no API key needed)
 *
 * Secrets (Cloudflare dashboard → Workers → max-api-proxy → Settings → Variables):
 *   MINIMAX_API_KEY    – sk-api-…  (optional, for TTS)
 *   MAILGUN_API_KEY    – xxxxxxxx-xxxxxxxx-xxxxxxxx  (Mailgun Sending API key)
 *   CF_API_TOKEN       – Cloudflare API token (optional fallback for REST AI API)
 *   CF_ACCOUNT_ID      – Cloudflare account ID (optional fallback for REST AI API)
 *
 * NOTE: Cloudflare Workers' FormData implementation causes Mailgun to reject
 * requests with "to parameter not valid". The fix is to construct the
 * multipart/form-data body manually as raw bytes so we control the exact
 * wire format — identical to what curl sends.
 */

const ALLOWED_ORIGINS = [
  'https://maxfacts.shanheart95.workers.dev',
  'https://preludeabc.pages.dev',
  'https://www.maxfacts.work',
  'https://maxfacts.work',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const TEACHER_EMAIL  = 'work@thebookprep.com';
const FROM_ADDRESS   = 'Max Recording App <recordings@mg.maxfacts.work>';
const MAILGUN_DOMAIN = 'mg.maxfacts.work';
const MAILGUN_URL    = `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`;

const MINIMAX_URL     = 'https://api.minimax.io/v1/t2a_v2';

/* Cloudflare Workers AI model IDs */
const CF_CHAT_MODEL   = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const CF_WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo';

/* ─── CORS helpers ──────────────────────────────────────────────── */
function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
    'Vary': 'Origin',
  };
}
function preflight(origin) {
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}
function err(msg, status, origin) {
  return json({ error: msg }, status, origin);
}

/* ─── base64 → Uint8Array ───────────────────────────────────────── */
function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* ─── Manual multipart/form-data builder ───────────────────────────
 *
 * Cloudflare Workers' built-in FormData produces a request that Mailgun
 * rejects with "to parameter not valid" — a known CF Workers quirk.
 * We build the multipart body as a raw Uint8Array so the wire format is
 * exactly the same as a curl --form call, which Mailgun accepts fine.
 *
 * Protocol:
 *   --<boundary>\r\n
 *   Content-Disposition: form-data; name="<field>"\r\n
 *   \r\n
 *   <value>\r\n
 *   ... repeat for each text field ...
 *   --<boundary>\r\n
 *   Content-Disposition: form-data; name="attachment"; filename="<name>"\r\n
 *   Content-Type: <mime>\r\n
 *   \r\n
 *   <binary bytes>\r\n
 *   --<boundary>--\r\n
 * ────────────────────────────────────────────────────────────────── */
function buildMultipart(fields, attachment) {
  const enc      = new TextEncoder();
  const boundary = `----CFWorkerBoundary${Date.now().toString(36)}`;
  const CRLF     = '\r\n';
  const parts    = [];

  // Text fields
  for (const [name, value] of Object.entries(fields)) {
    parts.push(enc.encode(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${name}"${CRLF}` +
      `${CRLF}` +
      `${value}${CRLF}`
    ));
  }

  // Binary attachment
  if (attachment) {
    parts.push(enc.encode(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="attachment"; filename="${attachment.filename}"${CRLF}` +
      `Content-Type: ${attachment.contentType}${CRLF}` +
      `${CRLF}`
    ));
    parts.push(attachment.bytes);          // raw audio bytes
    parts.push(enc.encode(CRLF));
  }

  // Closing delimiter
  parts.push(enc.encode(`--${boundary}--${CRLF}`));

  // Concatenate all parts into one Uint8Array
  const totalLen = parts.reduce((n, p) => n + p.byteLength, 0);
  const body     = new Uint8Array(totalLen);
  let offset = 0;
  for (const p of parts) {
    body.set(new Uint8Array(p.buffer ?? p), offset);
    offset += p.byteLength;
  }

  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

/* ─── Main handler ──────────────────────────────────────────────── */
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url    = new URL(request.url);

    if (request.method === 'OPTIONS') return preflight(origin);

    if (url.pathname === '/api/health')
      return json({ status: 'ok', ts: Date.now() }, 200, origin);

    if (request.method !== 'POST')
      return err('Method not allowed', 405, origin);

    /* ── /api/chat → Cloudflare Workers AI ── */
    if (url.pathname === '/api/chat') {
      let body;
      try { body = await request.json(); }
      catch { return err('Invalid JSON body', 400, origin); }
      if (!body?.messages || !Array.isArray(body.messages))
        return err('Missing messages array', 400, origin);

      try {
        const aiResult = await env.AI.run(CF_CHAT_MODEL, {
          messages: body.messages,
          temperature: body.temperature ?? 0.4,
          max_tokens: body.max_tokens ?? 4096,
        });

        /* Transform to OpenAI-compatible format so the frontend works unchanged */
        const raw = aiResult.response ?? aiResult.result ?? aiResult;
        const responseText = typeof raw === 'string' ? raw : JSON.stringify(raw);
        return json({
          choices: [{
            message: { role: 'assistant', content: responseText },
            finish_reason: 'stop',
          }],
          model: CF_CHAT_MODEL,
        }, 200, origin);
      } catch (e) {
        console.error('Cloudflare AI error:', e);
        return err(`AI error: ${e.message}`, 502, origin);
      }
    }

    /* ── /api/tts → MiniMax ── */
    if (url.pathname === '/api/tts') {
      if (!env.MINIMAX_API_KEY)
        return err('TTS service not configured (MINIMAX_API_KEY missing)', 503, origin);
      let body;
      try { body = await request.json(); }
      catch { return err('Invalid JSON body', 400, origin); }
      if (!body?.text || typeof body.text !== 'string')
        return err('Missing text field', 400, origin);
      body.model = 'speech-02-hd';
      const up = await fetch(MINIMAX_URL, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${env.MINIMAX_API_KEY}`,
        },
        body: JSON.stringify(body),
      });
      return json(await up.json(), up.status, origin);
    }

    /* ── /api/email → Mailgun (manual multipart) ── */
    if (url.pathname === '/api/email') {
      if (!env.MAILGUN_API_KEY)
        return err('Email service not configured', 503, origin);

      let body;
      try { body = await request.json(); }
      catch { return err('Invalid JSON body', 400, origin); }

      const { studentName, studentEmail, audioBase64, audioMime, articleTitle, speechText, writtenSpeech,
              speechMode, clientTime, clientTimezone } = body;
      if (!studentName || typeof studentName !== 'string')
        return err('Missing studentName', 400, origin);
      if (!audioBase64 || typeof audioBase64 !== 'string')
        return err('Missing audio data', 400, origin);

      /* Derive file extension from MIME */
      const mime = audioMime || 'audio/webm';
      const ext  = mime.includes('mp4') || mime.includes('m4a') ? 'm4a'
                 : mime.includes('ogg')                          ? 'ogg'
                 : 'webm';
      const filename    = `recording-${studentName.replace(/\s+/g, '-').toLowerCase()}.${ext}`;
      const safeStudent = (studentEmail || '').trim();
      const title         = (articleTitle  || 'article').trim().substring(0, 60);
      const safeText      = (speechText    || '').trim();    // Step 4 polished text
      const safeWritten   = (writtenSpeech || '').trim();    // Step 1 original written speech
      const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      /* Use the sender's local time if provided; otherwise fall back to PDT */
      let sentAt;
      if (clientTime && typeof clientTime === 'string' && clientTime.trim()) {
        sentAt = clientTime.trim();
      } else {
        sentAt = new Date().toLocaleString('en-US', {
          dateStyle: 'full', timeStyle: 'long',
          timeZone: 'America/Los_Angeles',
        }) + ' (PDT/PST)';
      }

      /* HTML email body */
      const htmlBody = `
        <div style="font-family:Inter,system-ui,sans-serif;max-width:600px;margin:0 auto;
                    background:#fdf8f0;border-radius:12px;overflow:hidden;border:1px solid #e8dcc8;">
          <div style="background:linear-gradient(135deg,#f59e0b,#ea580c);padding:28px 32px;">
            <h1 style="margin:0;color:#1c0a00;font-size:1.5rem;font-weight:700;text-shadow:none;">
              Max — New Student Recording
            </h1>
          </div>
          <div style="padding:28px 32px;">
            <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
              <tr><td style="padding:8px 0;color:#5c4a2a;font-weight:600;width:140px;">Student</td>
                  <td style="padding:8px 0;color:#1c1008;">${studentName}</td></tr>
              ${safeStudent
                ? `<tr><td style="padding:8px 0;color:#5c4a2a;font-weight:600;">Email</td>
                       <td style="padding:8px 0;color:#1c1008;">${safeStudent}</td></tr>`
                : ''}
              <tr><td style="padding:8px 0;color:#5c4a2a;font-weight:600;">Article</td>
                  <td style="padding:8px 0;color:#1c1008;">${title}</td></tr>
              <tr><td style="padding:8px 0;color:#5c4a2a;font-weight:600;">Submitted</td>
                  <td style="padding:8px 0;color:#1c1008;">${sentAt}</td></tr>
            </table>
            ${safeWritten ? `
            <div style="margin-bottom:24px;">
              <div style="font-weight:600;color:#5c4a2a;margin-bottom:8px;font-size:.9rem;letter-spacing:.3px;text-transform:uppercase;">Written Speech (Step 1)</div>
              <div style="background:#fff;border:1px solid #e8dcc8;border-radius:8px;padding:16px 20px;
                          font-size:.93rem;line-height:1.75;color:#1c1008;white-space:pre-wrap;">${esc(safeWritten)}</div>
            </div>` : ''}
            ${safeText ? `
            <div style="margin-bottom:24px;">
              <div style="font-weight:600;color:#5c4a2a;margin-bottom:8px;font-size:.9rem;letter-spacing:.3px;text-transform:uppercase;">${speechMode === 'reading-coach' ? 'Read This Aloud — Improved Summary (Step 4)' : 'Polished Speech for Recording (Step 4)'}</div>
              <div style="background:#f5f3ff;border:1px solid #c4b5fd;border-radius:8px;padding:16px 20px;
                          font-size:.93rem;line-height:1.75;color:#1c1008;white-space:pre-wrap;">${esc(safeText)}</div>
            </div>` : ''}
            <p style="color:#5c4a2a;font-size:.9rem;margin:0 0 8px;">
              Audio recording attached as <strong>${filename}</strong>.
            </p>
            <p style="color:#a08060;font-size:.8rem;margin:0;">
              Sent by the Max Reading &amp; Writing Coach app.
            </p>
          </div>
        </div>`.trim();

      /* Build text fields object — order matters for Mailgun multipart parsing.
         cc must appear before html so Mailgun sees all recipients before the body.
         We also add the student as a direct 'to' recipient alongside the teacher
         so they reliably receive a copy (CC can be stripped by some mail servers). */
      const toAddresses = safeStudent
        ? `${TEACHER_EMAIL},${safeStudent}`   // Mailgun accepts comma-separated to addresses
        : TEACHER_EMAIL;

      const fields = { from: FROM_ADDRESS, to: toAddresses };
      fields.subject = `New Recording - ${studentName} (Max App)`;
      fields.html    = htmlBody;

      /* Decode audio and build multipart body */
      const audioBytes = base64ToBytes(audioBase64);
      const { body: multipartBody, contentType } = buildMultipart(fields, {
        filename,
        contentType: mime,
        bytes: audioBytes,
      });

      /* POST to Mailgun with Basic auth */
      const credentials = btoa(`api:${env.MAILGUN_API_KEY}`);
      const mgResp = await fetch(MAILGUN_URL, {
        method:  'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type':  contentType,
        },
        body: multipartBody,
      });

      if (mgResp.ok) {
        const mgData = await mgResp.json().catch(() => ({}));
        console.log('Mailgun queued:', mgData?.id || mgData?.message);
        return json({ ok: true, id: mgData?.id }, 200, origin);
      }

      /* Parse Mailgun error */
      let mgErr = `HTTP ${mgResp.status}`;
      try {
        const errBody = await mgResp.text();
        // Mailgun returns JSON error bodies
        try {
          const parsed = JSON.parse(errBody);
          mgErr = parsed?.message || errBody;
        } catch { mgErr = errBody || mgErr; }
      } catch (_) {}
      console.error('Mailgun error:', mgErr);
      return json({ ok: false, error: `Mailgun: ${mgErr}` }, 502, origin);
    }

    /* ── /api/stt → Cloudflare Workers AI (Whisper) ── */
    if (url.pathname === '/api/stt') {
      /* Expects multipart/form-data with a field named 'audio' (audio file blob) */
      let formData;
      try { formData = await request.formData(); }
      catch { return err('Expected multipart/form-data', 400, origin); }
      const audioFile = formData.get('audio');
      if (!audioFile) return err('Missing audio field', 400, origin);

      try {
        /* Convert the uploaded file to an ArrayBuffer for Cloudflare AI */
        const audioBuffer = await audioFile.arrayBuffer();
        const audioArray = [...new Uint8Array(audioBuffer)];

        const result = await env.AI.run(CF_WHISPER_MODEL, {
          audio: audioArray,
        });

        return json({ ok: true, text: result.text || '' }, 200, origin);
      } catch (e) {
        console.error('Cloudflare STT error:', e);
        return err(`STT error: ${e.message}`, 502, origin);
      }
    }

    return err('Not found', 404, origin);
  },
};
