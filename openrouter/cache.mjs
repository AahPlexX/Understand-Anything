// openrouter/cache.mjs
// Fetches & caches the live OpenRouter model list.
// Free = pricing.prompt === "0" AND pricing.completion === "0"
// Per official schema: https://openrouter.ai/docs/guides/overview/models

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MODELS_URL   = 'https://openrouter.ai/api/v1/models';

let _cache     = null;
let _fetchedAt = 0;

export async function getLiveModels(apiKey) {
  const now = Date.now();
  if (_cache && (now - _fetchedAt) < CACHE_TTL_MS) return _cache;

  const res = await fetch(MODELS_URL, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/AahPlexX/Understand-Anything',
      'X-Title': 'understand-anything-router',
    },
  });

  if (!res.ok) {
    // On fetch failure, return stale cache if available, else throw
    if (_cache) {
      console.warn('[cache] Model list refresh failed, using stale cache');
      return _cache;
    }
    throw new Error(`OpenRouter /models fetch failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();

  // Filter free text models only.
  // Official schema: pricing.prompt and pricing.completion are string "0" for free models.
  const freeModels = json.data.filter(m => {
    const p = m.pricing;
    if (!p) return false;
    const isFreeTokens = p.prompt === '0' && p.completion === '0';
    const isTextOutput = m.architecture?.output_modalities?.includes('text');
    const notExpired   = !m.expiration_date;
    return isFreeTokens && isTextOutput && notExpired;
  });

  _cache     = freeModels;
  _fetchedAt = now;
  console.log(`[cache] Loaded ${freeModels.length} free models from OpenRouter`);
  return freeModels;
}

export function getCachedModels() {
  return _cache ?? [];
}
