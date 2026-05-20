---
name: understand-openrouter
description: >
  Bootstraps the OpenRouter free-model proxy before running any
  understand-anything pipeline command (/understand, /understand-diff,
  /understand-chat, /understand-domain, /understand-onboard).
  Invoked automatically whenever an understand-anything command is used
  and the proxy is not already running.
allowed-tools: shell
user-invocable: false
---

# OpenRouter Proxy Bootstrap

When any understand-anything pipeline command is about to run, first ensure
the OpenRouter proxy is active. Follow these steps:

## Step 1 — Check proxy health

```bash
curl -s http://localhost:4099/health 2>/dev/null | grep -q '"status":"ok"' && echo "PROXY_UP" || echo "PROXY_DOWN"
```

If output is `PROXY_UP`, skip to Step 3.

## Step 2 — Start the proxy (if not running)

```bash
cd "$(git rev-parse --show-toplevel)"
if [[ ! -f .env.openrouter ]]; then
  echo "ERROR: .env.openrouter missing. Copy .env.openrouter.example and add your OpenRouter key."
  echo "Get a free key at: https://openrouter.ai/keys"
  exit 1
fi
# Delegate to start-proxy.sh which uses set -a/set +a around `source`
# so ALL variables are exported to the nohup child process.
# Direct `source` without set -a does NOT export vars to child processes.
nohup ./openrouter/start-proxy.sh > /tmp/ua-proxy.log 2>&1 &
echo "Proxy PID: $!"
sleep 2
curl -s http://localhost:4099/health | grep -q '"status":"ok"' && echo "Proxy started successfully" || echo "WARNING: Proxy may still be starting — check /tmp/ua-proxy.log"
```

## Step 3 — Set environment for pipeline

```bash
export ANTHROPIC_BASE_URL="http://localhost:4099"
export ANTHROPIC_AUTH_TOKEN="proxy-passthrough"
export ANTHROPIC_API_KEY=""
```

## Step 4 — Proceed

After confirming the proxy is up and the environment is set, continue
with the originally requested understand-anything command exactly as invoked.
