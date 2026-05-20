// openrouter/proxy.mjs
// Intercepts Claude Code / VS Code Copilot pipeline calls.
// Injects ranked free model list + native OpenRouter server-side fallback chain.
// Zero human intervention needed.
//
// Docs:
//   OpenRouter model fallbacks: https://openrouter.ai/docs/guides/routing/model-fallbacks
//   OpenRouter models API:      https://openrouter.ai/docs/api/api-reference/models/get-models

import http  from 'node:http';
import https from 'node:https';
import { getLiveModels, getCachedModels } from './cache.mjs';
import { rankModelsForAgent } from './model-scorer.mjs';

// ─── Config ─────────────────────────────────────────────────────────────────
const PROXY_PORT      = parseInt(process.env.PROXY_PORT ?? '4099', 10);
const OPENROUTER_KEY  = process.env.OPENROUTER_API_KEY;
const OPENROUTER_HOST = 'openrouter.ai';

if (!OPENROUTER_KEY) {
  console.error('[proxy] FATAL: OPENROUTER_API_KEY is not set.');
  console.error('[proxy] Run: source .env.openrouter && node openrouter/proxy.mjs');
  process.exit(1);
}

// ─── Agent detection ─────────────────────────────────────────────────────────
// Scans the system prompt for understand-anything agent identity markers.
const AGENT_MARKERS = {
  'project-scanner':       ['project-scanner', 'discover all files', 'project structure scan'],
  'file-analyzer':         ['file-analyzer', 'extract functions', 'analyze imports'],
  'architecture-analyzer': ['architecture-analyzer', 'architectural layers', 'group into layers'],
  'tour-builder':          ['tour-builder', 'guided walkthrough', 'dependency order'],
  'graph-reviewer':        ['graph-reviewer', 'validate completeness', 'fix broken references'],
  'domain-analyzer':       ['domain-analyzer', 'business domain', 'business flows'],
};

function detectAgent(messages) {
  if (!Array.isArray(messages)) return 'default';
  const systemText = messages
    .filter(m => m.role === 'system' || m.role === 'user')
    .slice(0, 3)
    .map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n')
    .toLowerCase();

  for (const [agent, markers] of Object.entries(AGENT_MARKERS)) {
    if (markers.some(marker => systemText.includes(marker))) {
      return agent;
    }
  }
  return 'default';
}

// ─── Request transformer ──────────────────────────────────────────────────────
async function transformRequest(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body; // non-JSON passthrough (safe)
  }

  const agentName = detectAgent(parsed.messages ?? []);
  console.log(`[proxy] Agent detected: ${agentName}`);

  let rankedModels;
  try {
    const liveModels = await getLiveModels(OPENROUTER_KEY);
    rankedModels = rankModelsForAgent(liveModels, agentName);
  } catch (err) {
    console.error('[proxy] Model ranking failed:', err.message);
    rankedModels = ['openrouter/free'];
  }

  if (rankedModels.length === 0) {
    console.warn('[proxy] No qualified free models for agent, falling back to openrouter/free');
    rankedModels = ['openrouter/free'];
  }

  const preview = rankedModels.slice(0, 4).join(' → ');
  const more    = rankedModels.length > 4 ? ` → ... (+${rankedModels.length - 4} more)` : '';
  console.log(`[proxy] Fallback chain: ${preview}${more}`);

  // OpenRouter native fallback:
  //   model  = first choice (required field)
  //   models = full ranked list (server tries each in order on any error)
  //   https://openrouter.ai/docs/guides/routing/model-fallbacks
  parsed.model  = rankedModels[0];
  parsed.models = rankedModels;

  // Strip Anthropic-specific fields that OpenRouter doesn't accept
  delete parsed.anthropic_version;
  delete parsed.anthropic_beta;

  return JSON.stringify(parsed);
}

// ─── HTTP Proxy Server ────────────────────────────────────────────────────────
const server = http.createServer((clientReq, clientRes) => {

  // ── Health check endpoint (used by Copilot bootstrap skill) ──
  if (clientReq.url === '/health' && clientReq.method === 'GET') {
    const cachedCount = getCachedModels().length;
    clientRes.writeHead(200, { 'Content-Type': 'application/json' });
    clientRes.end(JSON.stringify({
      status: 'ok',
      cached_models: cachedCount,
      proxy: 'understand-anything-openrouter',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  const chunks = [];
  clientReq.on('data', chunk => chunks.push(chunk));

  clientReq.on('end', async () => {
    const rawBody   = Buffer.concat(chunks).toString('utf-8');
    const isChatReq = clientReq.url?.includes('/messages') ||
                      clientReq.url?.includes('/chat/completions');

    let transformedBody = rawBody;
    if (isChatReq && rawBody.length > 0) {
      transformedBody = await transformRequest(rawBody);
    }

    // Map Anthropic SDK paths → OpenRouter paths
    // Claude Code calls /v1/messages; OpenRouter expects /api/v1/chat/completions
    let targetPath = clientReq.url ?? '/';
    if (targetPath.includes('/v1/messages')) {
      targetPath = targetPath.replace('/v1/messages', '/api/v1/chat/completions');
    } else if (!targetPath.startsWith('/api')) {
      targetPath = '/api' + targetPath;
    }

    const bodyBuffer = Buffer.from(transformedBody, 'utf-8');

    const upstreamOptions = {
      hostname: OPENROUTER_HOST,
      port: 443,
      path: targetPath,
      method: clientReq.method,
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': bodyBuffer.length,
        'Authorization':  `Bearer ${OPENROUTER_KEY}`,
        'HTTP-Referer':   'https://github.com/AahPlexX/Understand-Anything',
        'X-Title':        'understand-anything-router',
      },
    };

    const upstreamReq = https.request(upstreamOptions, upstreamRes => {
      clientRes.writeHead(upstreamRes.statusCode, upstreamRes.headers);
      upstreamRes.pipe(clientRes);
    });

    upstreamReq.on('error', err => {
      console.error('[proxy] Upstream request error:', err.message);
      if (!clientRes.headersSent) {
        clientRes.writeHead(502);
        clientRes.end(JSON.stringify({
          error: { message: err.message, type: 'proxy_error' }
        }));
      }
    });

    upstreamReq.write(bodyBuffer);
    upstreamReq.end();
  });
});

server.listen(PROXY_PORT, '127.0.0.1', () => {
  console.log('\n================================================');
  console.log(' understand-anything | OpenRouter Free Proxy');
  console.log('================================================');
  console.log(`  Listening : http://localhost:${PROXY_PORT}`);
  console.log(`  Upstream  : https://${OPENROUTER_HOST}`);
  console.log(`  Health    : http://localhost:${PROXY_PORT}/health`);
  console.log(`  Cache TTL : 5 minutes`);
  console.log('================================================\n');
});

process.on('SIGINT',  () => { console.log('\n[proxy] Shutting down gracefully.'); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
