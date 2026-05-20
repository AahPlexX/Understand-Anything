// openrouter/cache.mjs
// Fetches & caches the live OpenRouter model list.
// Free = pricing.prompt === "0" AND pricing.completion === "0"
// Per official schema: https://openrouter.ai/docs/guides/overview/models

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MODELS_URL   = 'https://openrouter.ai/api/v1/models';

let _cache        = null;
let _fetchedAt    = 0;
let _inflightReq  = null; // fix: deduplicate concurrent refreshes (cache stampede)

export async function getLiveModels(apiKey) {
  const now = Date.now();
  if (_cache && (now - _fetchedAt) < CACHE_TTL_MS) return _cache;

  // If a refresh is already in-flight, wait for it instead of firing another
  if (_inflightReq) return _inflightReq;

  _inflightReq = _fetchModels(apiKey).finally(() => { _inflightReq = null; });
  return _inflightReq;
}

async function _fetchModels(apiKey) {
  const now = Date.now();

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

  // fix: wrap parse + filter in try/catch so schema/JSON errors fall back to stale cache
  let freeModels;
  try {
    const json = await res.json();
    const data = Array.isArray(json.data) ? json.data : [];
    const nowTs = Date.now();

    freeModels = data.filter(m => {
      const p = m.pricing;
      if (!p) return false;
      const isFreeTokens = p.prompt === '0' && p.completion === '0';
      const isTextOutput = m.architecture?.output_modalities?.includes('text');
      // fix: compare expiration_date against current time, not just field presence
      const notExpired   = !m.expiration_date || new Date(m.expiration_date).getTime() > nowTs;
      return isFreeTokens && isTextOutput && notExpired;
    });
  } catch (parseErr) {
    console.warn('[cache] Failed to parse /models response:', parseErr.message);
    if (_cache) {
      console.warn('[cache] Returning stale cache due to parse error');
      return _cache;
    }
    throw parseErr;
  }

  _cache     = freeModels;
  _fetchedAt = now;
  console.log(`[cache] Loaded ${freeModels.length} free models from OpenRouter`);
  return freeModels;
}

export function getCachedModels() {
  return _cache ?? [];
}
