# Qu Tumblr authorization service

This Cloudflare Worker lets people connect Tumblr accounts to Qu without exposing or entering the application's consumer credentials.

It stores an encrypted, short-lived OAuth session in Workers KV. After Tumblr approval, the desktop app retrieves the resulting OAuth 2 tokens once and the completed session is deleted.

## Required Cloudflare resources

- Worker: `qu-tumblr-auth`
- KV binding: `QU_OAUTH_SESSIONS`
- Encrypted secrets: `TUMBLR_CONSUMER_KEY` and `TUMBLR_CONSUMER_SECRET`

Never commit real Tumblr credentials, `.dev.vars`, or exported Cloudflare settings.

## Tumblr callback

Register this exact callback URL in the Tumblr application:

`https://nullgurll.github.io/Qu-Tumblr-Multi-Account-Content-Scheduler/oauth-callback.html`

The GitHub Pages callback forwards Tumblr's authorization response to the Worker endpoint at `/v1/oauth/callback`.

## Endpoints

- `GET /health` — safe service configuration status
- `POST /v2/oauth/start` — starts a short-lived OAuth 2 authorization session
- `GET /v1/oauth/callback` — receives Tumblr approval
- `GET /v1/oauth/session/:id` — one-time session retrieval by Qu
- `POST /v2/oauth/refresh` — refreshes an expired Tumblr access token

Run the Worker tests with `pnpm test`.
