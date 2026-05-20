// openrouter/model-scorer.mjs
// Scores free models automatically from live metadata.
// Higher = better. Top-scored model goes first in the fallback chain.

/**
 * Per-agent capability requirements.
 * Maps to OpenRouter's supported_parameters field names.
 * https://openrouter.ai/docs/guides/overview/models#supported-parameters
 */
export const AGENT_REQUIREMENTS = {
  'project-scanner':       { needsTools: false, minContext: 32_000,  needsStructured: false },
  'file-analyzer':         { needsTools: true,  minContext: 128_000, needsStructured: false },
  'architecture-analyzer': { needsTools: true,  minContext: 64_000,  needsStructured: true  },
  'tour-builder':          { needsTools: true,  minContext: 64_000,  needsStructured: true  },
  'graph-reviewer':        { needsTools: true,  minContext: 32_000,  needsStructured: true  },
  'domain-analyzer':       { needsTools: true,  minContext: 64_000,  needsStructured: true  },
  'default':               { needsTools: true,  minContext: 32_000,  needsStructured: false },
};

/**
 * Score a single model for a given agent's requirements.
 * Returns a numeric score (higher = better).
 * Returns -1 if the model fails a hard requirement (disqualified).
 */
export function scoreModel(model, agentName = 'default') {
  const req      = AGENT_REQUIREMENTS[agentName] ?? AGENT_REQUIREMENTS['default'];
  const params   = model.supported_parameters ?? [];
  const ctx      = model.context_length ?? 0;
  const hasTools = params.includes('tools');
  const hasStructured = params.includes('structured_outputs') || params.includes('response_format');

  // --- Hard disqualifications ---
  if (req.needsTools && !hasTools)           return -1;
  if (ctx < req.minContext)                  return -1;
  if (req.needsStructured && !hasStructured) return -1;

  let score = 0;

  // Context window: more is better, log-scaled
  score += Math.min(Math.log2(ctx / 1000) * 10, 80);

  // Tool calling support bonus
  if (hasTools)      score += 30;

  // Structured output support bonus
  if (hasStructured) score += 25;

  // Reasoning/chain-of-thought support bonus
  if (params.includes('reasoning') || params.includes('include_reasoning')) score += 20;

  // Penalize models with per_request_limits set (likely rate-constrained)
  if (model.per_request_limits != null) score -= 15;

  // Recency bonus — newer models score marginally higher all else equal
  // model.created is a Unix timestamp (per official schema)
  const ageMonths = (Date.now() / 1000 - (model.created ?? 0)) / (60 * 60 * 24 * 30);
  score += Math.max(0, 20 - ageMonths * 0.5); // decays over ~40 months

  return Math.round(score);
}

/**
 * Returns the ranked model ID list for a given agent.
 * First item = best candidate, rest = sequential fallbacks.
 * Disqualified models (score -1) are excluded entirely.
 */
export function rankModelsForAgent(models, agentName = 'default') {
  return models
    .map(m => ({ id: m.id, score: scoreModel(m, agentName) }))
    .filter(m => m.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map(m => m.id);
}
