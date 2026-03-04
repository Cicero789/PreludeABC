/**
 * config.js — Max app configuration
 *
 * API keys have been moved to the Cloudflare Worker (max-api-proxy).
 * The browser never sees any credentials.
 *
 * Worker URL: https://max-api-proxy.shanheart95.workers.dev
 * Keys stored as Worker Secrets (OPENAI_API_KEY, MINIMAX_API_KEY)
 * via Cloudflare dashboard → Workers & Pages → max-api-proxy → Settings → Variables
 */
window.APP_CONFIG = {
  // No keys here — all proxied through the Cloudflare Worker
};
