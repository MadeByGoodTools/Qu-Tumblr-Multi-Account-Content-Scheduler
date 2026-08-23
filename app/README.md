# Qu desktop app

Qu is an Electron desktop workspace for preparing, organizing, and publishing Tumblr posts.

## Current capabilities

- Create, edit, duplicate, search, filter, and bulk-remove posts
- Add multiple images by selecting files or dragging them into the editor
- Set captions, separate tags, and publishing modes
- Use Tumblr's native queue, Qu's posting times, a custom schedule, or immediate publishing
- Connect and switch between as many as four Tumblr accounts
- Synchronize Tumblr queue entries with Qu's calendar
- Save reusable templates and account-specific local workspaces
- Open major AI assistants in a resizable side panel
- Record successful Tumblr post IDs and keep failed posts ready to retry

## Connect an account

Create an account profile with a display name and Tumblr blog identifier. Select **Connect with Tumblr**, choose a browser, and approve Qu on Tumblr. Qu polls the secure authorization session and finishes the connection automatically.

The shared callback registered for the Qu Tumblr application is:

`https://nullgurll.github.io/Qu-Tumblr-Multi-Account-Content-Scheduler/oauth-callback.html`

Users do not need the application's consumer key or consumer secret. The fields under **Legacy/manual Tumblr credentials** are only for existing manual configurations.

## Run and build

```bash
pnpm install
pnpm start
```

Build Windows or macOS installers with:

```bash
pnpm run dist:win
pnpm run dist:mac
```

## Privacy

Drafts remain on the computer. Account tokens are encrypted through Electron `safeStorage` and are never stored in the renderer's local storage.
