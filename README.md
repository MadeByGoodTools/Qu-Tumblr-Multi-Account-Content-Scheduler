# Qu

Qu is a visual desktop publishing workspace for preparing, organizing, scheduling, and posting multiple Tumblr posts efficiently.

**Current version: 0.8.7**

| Platform | Download |
| --- | --- |
| Windows 64-bit | [Qu 0.8.7 installer](https://github.com/NullGurll/Qu/releases/download/v0.8.7/Qu-Setup-0.8.7-x64.exe) |
| macOS Intel and Apple Silicon | [Qu 0.8.7 universal installer](https://github.com/NullGurll/Qu/releases/download/v0.8.7/Qu-Setup-0.8.7-universal.dmg) |

[Release notes and checksums](https://github.com/NullGurll/Qu/releases/tag/v0.8.7)

![Qu visual posting workspace](docs/images/qu-workspace.png)

## Highlights

- Prepare text and image posts from one organized workspace
- Add captions, images, separately parsed tags, and publishing modes
- Publish immediately, schedule a specific time, use Qu's posting times, or add to Tumblr's native queue
- Manage as many as four Tumblr accounts and switch between their separate workspaces
- Synchronize the active account's Tumblr queue and calendar
- Create templates, duplicate posts, apply bulk tags, and remove one or many drafts
- Open ChatGPT, Claude, Gemini, or DeepSeek beside the editor
- Connect accounts through automatic Tumblr OAuth 2 authorization

## What changed in 0.8.7

- Removes the mature-content controls that Tumblr's public posting API does not reliably preserve.
- Leaves content classification to Tumblr's own automated moderation system.
- Simplifies the post editor and refreshes the repository screenshot to match the current interface.

## Account connection

Qu opens Tumblr in the browser you choose. After you approve access, the callback page and Qu authorization service complete the connection automatically. Users do not need the application's Tumblr consumer secret.

Registered callback URL:

`https://nullgurll.github.io/Qu/oauth-callback.html`

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

Run the automated checks with:

```bash
cd app
pnpm test
```

## Privacy and security

Drafts stay on the user's computer. Tumblr access and refresh tokens are stored using Electron's protected credential storage. The Worker keeps only a short-lived authorization session and deletes it after it is retrieved by Qu. Real Tumblr credentials and Cloudflare secrets are not included in this repository.

## License

Qu is available under the [Mozilla Public License 2.0](app/LICENSE).
