git credential - thedevsyst@gmail.com
# Render: Stream Proxy Web Service (deployment notes)

This file documents the Render deployment for the stream-proxy backend and includes build/start instructions, public endpoints, and quick test commands.

## Deployment
- Render Deploy URL (console): https://dashboard.render.com/web/srv-d2kb0tu3jp1c7381q7g0/deploys/dep-d2kbompu749s73a4v9ag
- Public service URL: https://stream-proxy-ug0m.onrender.com

## Source
- Repository: https://github.com/thedevsyst/stream-proxy
- Branch: `main`

> Note: Do not store secrets or credentials in this file. Use Render environment variables or a secrets manager for API keys and tokens.

## Build & Start
- Build command: `npm install`
- Start command: `node server/stream-proxy.js`

Render will run the start command after a successful build. Ensure required environment variables are configured in the Render service settings.

## Endpoints
- Health check (recommended for readiness/liveness probes):
	- `https://stream-proxy-ug0m.onrender.com/health`
- Streaming API path (POST):
	- `https://stream-proxy-ug0m.onrender.com/api/ai/stream`

## Quick test (curl)
Use these curl examples to verify the service is responding and streaming correctly.

Public (via Render):
```bash
curl -N -X POST https://stream-proxy-ug0m.onrender.com/api/ai/stream \
	-H "Content-Type: application/json" \
	-d '{"model":"gpt-4.1","messages":[{"role":"user","content":"Say hello in one sentence"}],"serverIdx":0}'
```

Local (if you run the server on your machine or VPS):
```bash
curl -N -X POST http://localhost:7866/api/ai/stream \
	-H "Content-Type: application/json" \
	-d '{"model":"gpt-4.1","messages":[{"role":"user","content":"Say hello in one sentence"}],"serverIdx":0}'
```

## Notes & Recommendations
- Use Render environment variables to inject API keys (do not commit keys to git).
- Configure a liveness and readiness probe using the `/health` endpoint.
- Monitor logs in Render's dashboard; add alerting if required.
- If you require persistent storage or file uploads, configure an external object store (S3-compatible) and update the proxy to use signed URLs.

If you want, I can also add a short `README.md` to the repository root with these deployment/test instructions.

