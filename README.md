# Qu

Qu is a visual desktop publishing workspace for preparing, organizing, and posting multiple Tumblr posts efficiently.

[Download Qu 0.8.2](https://github.com/NullGurll/qu/releases/tag/v0.8.2)

![Qu visual posting workspace](docs/images/qu-workspace.png)

## Highlights

- Prepare text and image posts from one organized workspace
- Add captions, individual tags, Tumblr content labels, and publishing modes
- Publish immediately, schedule a specific time, use Qu's posting times, or add to Tumblr's native queue
- Manage as many as four Tumblr accounts and switch between their separate workspaces
- Synchronize the active account's Tumblr queue and calendar
- Create templates, duplicate posts, apply bulk tags, and remove one or many drafts
- Open ChatGPT, Claude, Gemini, or DeepSeek beside the editor
- Connect accounts through automatic Tumblr OAuth 2 authorization
- Preserve Tumblr's Mature, Drug Use, Violence, and Sexual Themes labels when posting

## Account connection

Qu opens Tumblr in the browser you choose. After you approve access, the callback page and Qu authorization service complete the connection automatically. Users do not need the application's Tumblr consumer secret.

Registered callback URL:

`https://nullgurll.github.io/qu/oauth-callback.html`

## Repository layout

- `app/` — Electron desktop application
- `worker/` — Cloudflare Worker used for Tumblr OAuth authorization
- `oauth-callback.html` — public GitHub Pages callback
- `docs/images/` — repository screenshots

## Run from source

Install Node.js 20 or newer and pnpm, then run:

```bash
cd app
pnpm install
pnpm start
```

Build installers with `pnpm run dist:win` or `pnpm run dist:mac`.

## Privacy and security

Drafts stay on the user's computer. Tumblr access and refresh tokens are stored using Electron's protected credential storage. The Worker keeps only a short-lived authorization session and deletes it after it is retrieved by Qu. Real Tumblr credentials and Cloudflare secrets are not included in this repository.

## License

Qu is available under the [Mozilla Public License 2.0](app/LICENSE).
