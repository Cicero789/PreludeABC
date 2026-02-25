/**
 * Max — Cloudflare Worker API Proxy  (worker.js)
 *
 * Routes:
 *   POST /api/chat        → OpenAI  /v1/chat/completions
 *   POST /api/tts         → MiniMax /v1/t2a_v2
 *   OPTIONS *             → CORS pre-flight
 *
 * Secrets stored as Worker Environment Variables (never in source):
 *   OPENAI_API_KEY   – sk-proj-…
 *   MINIMAX_API_KEY  – sk-api-…
 *
 * CORS: only the Pages domain (and localhost for dev) is allowed.
 */

const ALLOWED_ORIGINS = [
  'https://preludeabc.pages.dev',       // Cloudflare Pages production
  'https://www.maxfacts.work',       // custom domain (add yours here)
  'https://maxfacts.work',
  'http://localhost:3000',              // local dev
  'http://127.0.0.1:3000',
];

const OPENAI_URL  = 'https://api.openai.com/v1/chat/completions';
const MINIMAX_URL = 'https://api.minimax.io/v1/t2a_v2';

/* ─── CORS helpers ──────────────────────────────────────────────── */
function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

/* ─── Main handler ──────────────────────────────────────────────── */
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url    = new URL(request.url);

    // CORS pre-flight
    if (request.method === 'OPTIONS') return preflight(origin);

    /* ── Health check (GET) ──────────────────────────────────── */
    if (url.pathname === '/api/health') {
      return json({ status: 'ok', ts: Date.now() }, 200, origin);
    }

    // Only POST from here on
    if (request.method !== 'POST')
      return err('Method not allowed', 405, origin);

    /* ── /api/chat  →  OpenAI ─────────────────────────────────── */
    if (url.pathname === '/api/chat') {
      let body;
      try { body = await request.json(); }
      catch { return err('Invalid JSON body', 400, origin); }

      // Validate minimal shape — must have messages array
      if (!body?.messages || !Array.isArray(body.messages))
        return err('Missing messages array', 400, origin);

      // Force model to gpt-4o so the client cannot override it
      body.model = 'gpt-4o';

      const upstream = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify(body),
      });

      const data = await upstream.json();
      return json(data, upstream.status, origin);
    }

    /* ── /api/tts  →  MiniMax ────────────────────────────────── */
    if (url.pathname === '/api/tts') {
      let body;
      try { body = await request.json(); }
      catch { return err('Invalid JSON body', 400, origin); }

      if (!body?.text || typeof body.text !== 'string')
        return err('Missing text field', 400, origin);

      // Enforce safe model — client cannot request a different model
      body.model = 'speech-02-hd';

      const upstream = await fetch(MINIMAX_URL, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${env.MINIMAX_API_KEY}`,
        },
        body: JSON.stringify(body),
      });

      const data = await upstream.json();
      return json(data, upstream.status, origin);
    }

    return err('Not found', 404, origin);
  },
};
