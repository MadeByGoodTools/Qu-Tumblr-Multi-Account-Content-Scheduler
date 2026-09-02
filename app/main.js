// SPDX-License-Identifier: MPL-2.0
const { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog, safeStorage, nativeImage, session } = require("electron");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { isTumblrAuthorizationUrl, extractTumblrCallbackParameters } = require("./tumblr-auth");
const { startAutoUpdates } = require("./updater");
const authorizationSessions = new Map();
const OAUTH_SERVICE_URL = "https://qu-tumblr-auth.nullgurl.workers.dev";
const aiSidebars = new Map();
const AI_PARTITION = "persist:qu-ai-sidebar";
const AI_PROVIDERS = Object.freeze({
  chatgpt: { name: "ChatGPT", url: "https://chatgpt.com/" },
  claude: { name: "Claude", url: "https://claude.ai/new" },
  gemini: { name: "Gemini", url: "https://gemini.google.com/app" },
  deepseek: { name: "DeepSeek", url: "https://chat.deepseek.com/" },
  copilot: { name: "Copilot", url: "https://copilot.microsoft.com/" }
});
const AI_RAIL_WIDTH = 0;
const AI_HEADER_HEIGHT = 104;

function isSafeWebUrl(value) {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function aiStateFor(sender) {
  const win = BrowserWindow.fromWebContents(sender);
  return win ? aiSidebars.get(win.id) : null;
}

function updateAiSidebarBounds(win) {
  const state = aiSidebars.get(win.id);
  if (!state?.view || !state.open || !state.bounds || win.isDestroyed()) return;
  const { x, y, width, height } = state.bounds;
  const [contentWidth, contentHeight] = win.getContentSize();
  const left = Math.max(0, x + AI_RAIL_WIDTH);
  const top = Math.max(0, y + AI_HEADER_HEIGHT);
  const right = Math.min(contentWidth, x + width);
  const bottom = Math.min(contentHeight, y + height);
  state.view.setBounds({
    x: Math.round(left), y: Math.round(top),
    width: Math.max(1, Math.round(right - left)),
    height: Math.max(1, Math.round(bottom - top))
  });
}

function createAiView(win, state) {
  if (state.view && !state.view.webContents.isDestroyed()) return state.view;
  const view = new WebContentsView({ webPreferences: {
    partition: AI_PARTITION, nodeIntegration: false, contextIsolation: true,
    sandbox: true, webSecurity: true
  } });
  view.setBackgroundColor("#0b0d12");
  view.webContents.on("will-navigate", (event, url) => {
    if (!isSafeWebUrl(url)) event.preventDefault();
  });
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (!isSafeWebUrl(url)) return { action: "deny" };
    return { action: "allow", overrideBrowserWindowOptions: {
      parent: win, width: 980, height: 800, backgroundColor: "#0b0d12",
      webPreferences: { partition: AI_PARTITION, nodeIntegration: false,
        contextIsolation: true, sandbox: true, webSecurity: true }
    } };
  });
  state.view = view;
  return view;
}

function openAiSidebar(win, state) {
  const view = createAiView(win, state);
  if (!win.contentView.children.includes(view)) win.contentView.addChildView(view);
  state.open = true;
  updateAiSidebarBounds(win);
  const target = AI_PROVIDERS[state.provider].url;
  if (state.loadedProvider !== state.provider) {
    state.loadedProvider = state.provider;
    view.webContents.loadURL(target);
  }
}

function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function decrypt(value) {
  if (!value || !safeStorage.isEncryptionAvailable()) return "";
  return safeStorage.decryptString(Buffer.from(value, "base64"));
}

function encrypt(value) {
  if (!value || !safeStorage.isEncryptionAvailable()) return "";
  return safeStorage.encryptString(value).toString("base64");
}

function oauthHeader({ method, url, consumerKey, consumerSecret, token, tokenSecret, extra = {} }) {
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomBytes(18).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: "1.0",
    ...extra
  };
  if (token) oauth.oauth_token = token;
  const query = Object.fromEntries(new URL(url).searchParams.entries());
  const parameters = { ...query, ...oauth };
  const normalized = Object.entries(parameters)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      percentEncode(leftKey).localeCompare(percentEncode(rightKey)) ||
      percentEncode(leftValue).localeCompare(percentEncode(rightValue)))
    .map(([key, value]) => `${percentEncode(key)}=${percentEncode(value)}`)
    .join("&");
  const baseUrl = `${new URL(url).origin}${new URL(url).pathname}`;
  const base = [method.toUpperCase(), percentEncode(baseUrl), percentEncode(normalized)].join("&");
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret || "")}`;
  oauth.oauth_signature = crypto.createHmac("sha1", signingKey).update(base).digest("base64");
  return "OAuth " + Object.entries(oauth)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${percentEncode(key)}="${percentEncode(value)}"`)
    .join(", ");
}

function profileSecrets(profile) {
  return {
    consumerKey: profile.key,
    consumerSecret: decrypt(profile.secret),
    token: decrypt(profile.accessToken),
    tokenSecret: decrypt(profile.accessTokenSecret)
  };
}

async function refreshOAuth2Profile(profile) {
  if (!profile.refreshToken) throw new Error("Reconnect this Tumblr account to renew access.");
  const response = await fetchWithTimeout(`${OAUTH_SERVICE_URL}/v2/oauth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json", "User-Agent": "Qu/0.8.8" },
    body: JSON.stringify({ refreshToken: decrypt(profile.refreshToken) })
  });
  const values = await response.json();
  if (!response.ok || !values.accessToken) throw new Error(values.error || "Tumblr token renewal failed.");
  profile.accessToken = encrypt(values.accessToken);
  profile.refreshToken = encrypt(values.refreshToken || decrypt(profile.refreshToken));
  profile.tokenExpiresAt = Date.now() + Math.max(0, Number(values.expiresIn || 0) * 1000);
  const settings = readConnections();
  const index = settings.profiles.findIndex((item) => item.id === profile.id);
  if (index >= 0) {
    settings.profiles[index] = profile;
    writeConnections(settings);
  }
}

async function tumblrRequest(profile, method, url, options = {}) {
  if (profile.authMode === "oauth2" && profile.accessToken) {
    if (profile.tokenExpiresAt && profile.tokenExpiresAt <= Date.now() + 60_000) {
      await refreshOAuth2Profile(profile);
    }
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${decrypt(profile.accessToken)}`,
        "User-Agent": "Qu/0.8.8",
        ...(options.headers || {})
      },
      body: options.body
    });
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = Object.fromEntries(new URLSearchParams(raw)); }
    if (!response.ok) {
      const message = data?.errors?.[0]?.detail || data?.meta?.msg || data?.error_description ||
        data?.error || `Tumblr returned ${response.status}.`;
      throw new Error(message);
    }
    return data;
  }
  const secrets = profileSecrets(profile);
  const authorization = oauthHeader({
    method, url,
    consumerKey: secrets.consumerKey,
    consumerSecret: secrets.consumerSecret,
    token: secrets.token,
    tokenSecret: secrets.tokenSecret,
    extra: options.oauth || {}
  });
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: authorization,
      "User-Agent": "Qu/0.8.8",
      ...(options.headers || {})
    },
    body: options.body
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = Object.fromEntries(new URLSearchParams(raw)); }
  if (!response.ok) {
    const message = data?.errors?.[0]?.detail || data?.meta?.msg || data?.error || `Tumblr returned ${response.status}.`;
    throw new Error(message);
  }
  return data;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Tumblr did not respond within 15 seconds. Check your internet connection and try again.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function verifyProfile(profile) {
  if (!profile.accessToken || (profile.authMode !== "oauth2" && !profile.accessTokenSecret)) {
    throw new Error("Authorize this account first.");
  }
  const data = await tumblrRequest(profile, "GET", "https://api.tumblr.com/v2/user/info");
  const blogs = data?.response?.user?.blogs || [];
  function identifiers(value) {
    const result = new Set();
    const raw = String(value || "").trim().toLowerCase().replace(/\/+$/, "");
    if (!raw) return result;
    result.add(raw);
    result.add(raw.replace(/^https?:\/\//, ""));
    const hostnameStyle = raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    if (/^[^.\/]+\.tumblr\.com$/.test(hostnameStyle)) {
      result.add(hostnameStyle.replace(/\.tumblr\.com$/, ""));
    }
    try {
      const parsed = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
      const hostname = parsed.hostname.toLowerCase();
      result.add(hostname);
      if (hostname.endsWith(".tumblr.com") && hostname !== "www.tumblr.com") {
        result.add(hostname.slice(0, -".tumblr.com".length));
      }
      if (hostname === "www.tumblr.com") {
        const slug = parsed.pathname.split("/").filter(Boolean)[0]?.replace(/^@/, "");
        if (slug) result.add(slug.toLowerCase());
      }
    } catch {
      // The raw name or UUID is still a valid comparison candidate.
    }
    return result;
  }
  const wanted = identifiers(profile.blog);
  const matched = blogs.find((blog) => {
    const available = new Set();
    for (const value of [blog.name, blog.url, blog.uuid]) {
      for (const identifier of identifiers(value)) available.add(identifier);
    }
    return [...wanted].some((identifier) => available.has(identifier));
  });
  if (!matched) throw new Error(`The authorized Tumblr user cannot post to ${profile.blog}.`);
  return { name: matched.name, url: matched.url, uuid: matched.uuid };
}

function normalizedTimes(times) {
  const clean = [...new Set((times || [])
    .filter((value) => /^\d{2}:\d{2}$/.test(value))
    .sort())];
  return clean.length ? clean : ["08:00", "11:00", "14:00", "17:00", "20:00", "23:00"];
}

function queueSlots(times, count, after = new Date()) {
  const schedule = normalizedTimes(times);
  const slots = [];
  const cursor = new Date(after);
  cursor.setSeconds(0, 0);
  for (let dayOffset = 0; slots.length < count && dayOffset < 370; dayOffset += 1) {
    const day = new Date(cursor);
    day.setDate(cursor.getDate() + dayOffset);
    for (const value of schedule) {
      const [hours, minutes] = value.split(":").map(Number);
      const slot = new Date(day);
      slot.setHours(hours, minutes, 0, 0);
      if (slot > after) slots.push(slot);
      if (slots.length >= count) break;
    }
  }
  return slots;
}

async function queueStatus(profile) {
  const endpoint = `https://api.tumblr.com/v2/blog/${percentEncode(profile.blog)}/posts/queue?limit=20&npf=true`;
  const data = await tumblrRequest(profile, "GET", endpoint);
  const posts = data?.response?.posts || [];
  const total = Number(data?.response?.total_posts || posts.length || 0);
  const now = new Date();
  const scheduledDates = posts
    .map((post) => {
      if (post.publish_on) return new Date(post.publish_on);
      if (post.scheduled_publish_time) {
        const value = Number(post.scheduled_publish_time);
        return new Date(value > 1e12 ? value : value * 1000);
      }
      return null;
    })
    .filter((date) => date && !Number.isNaN(date.getTime()) && date > now)
    .sort((a, b) => a - b);
  const estimatedSlots = queueSlots(profile.queueTimes, Math.max(total, 1), now);
  const lastSlot = scheduledDates.at(-1)
    || (total ? estimatedSlots[total - 1] : null);
  const nextSlot = queueSlots(profile.queueTimes, 1, lastSlot || now)[0] || null;
  return {
    total,
    times: normalizedTimes(profile.queueTimes),
    nextSlot: nextSlot?.toISOString() || null,
    lastSlot: lastSlot?.toISOString() || null,
    exactLastSlot: Boolean(scheduledDates.length)
  };
}

function tumblrScheduledDate(post) {
  if (post.publish_on) return new Date(post.publish_on);
  if (post.scheduled_publish_time) {
    const value = Number(post.scheduled_publish_time);
    return new Date(value > 1e12 ? value : value * 1000);
  }
  return null;
}

function tumblrPostSummary(post) {
  const text = (post.content || []).find((block) => block.type === "text")?.text
    || post.summary || post.slug || "Tumblr queued post";
  return String(text).replace(/\s+/g, " ").trim().slice(0, 100) || "Tumblr queued post";
}

async function calendarPosts(profile) {
  const collected = [];
  let offset = 0;
  let total = 0;
  do {
    const endpoint = `https://api.tumblr.com/v2/blog/${percentEncode(profile.blog)}/posts/queue?limit=20&offset=${offset}&npf=true`;
    const data = await tumblrRequest(profile, "GET", endpoint);
    const posts = data?.response?.posts || [];
    total = Math.min(1000, Number(data?.response?.total_posts || posts.length));
    for (const post of posts) {
      const scheduled = tumblrScheduledDate(post);
      collected.push({
        id: String(post.id_string || post.id || ""),
        title: tumblrPostSummary(post),
        scheduledAt: scheduled && !Number.isNaN(scheduled.getTime()) ? scheduled.toISOString() : null,
        postUrl: /^https:\/\//.test(post.post_url || "") ? post.post_url : null,
        source: scheduled ? "tumblr" : "native"
      });
    }
    if (!posts.length) break;
    offset += posts.length;
  } while (offset < total);
  return { posts: collected, total, syncedAt: new Date().toISOString() };
}

function decodeDataUrl(dataUrl) {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl || "");
  if (!match) throw new Error("An image in this draft is not readable.");
  return { type: match[1], bytes: Buffer.from(match[2], "base64") };
}

function normalizeTags(tags) {
  const values = Array.isArray(tags) ? tags : [tags];
  const result = [];
  const seen = new Set();
  for (const value of values) {
    for (const tag of String(value || "").split(/[,#\n\r]+/)) {
      const clean = tag.trim().replace(/^#+/, "");
      const key = clean.toLocaleLowerCase();
      if (clean && !seen.has(key)) {
        seen.add(key);
        result.push(clean);
      }
    }
  }
  return result;
}

function safeUploadName(name, index, mimeType) {
  const fallbackExtension = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp"
  }[mimeType] || "";
  const clean = path.basename(String(name || ""))
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return clean || `image-${index + 1}${fallbackExtension}`;
}

function multipartPostBody(payload, uploads) {
  const boundary = `----QuTumblrBoundary${crypto.randomBytes(18).toString("hex")}`;
  const chunks = [];
  const line = (value) => chunks.push(Buffer.from(value, "utf8"));
  line(`--${boundary}\r\n`);
  line('Content-Disposition: form-data; name="json"\r\n');
  line("Content-Type: application/json\r\n\r\n");
  line(`${JSON.stringify(payload)}\r\n`);
  for (const upload of uploads) {
    line(`--${boundary}\r\n`);
    line(`Content-Disposition: form-data; name="${upload.identifier}"; filename="${upload.name}"\r\n`);
    line(`Content-Type: ${upload.decoded.type}\r\n\r\n`);
    chunks.push(upload.decoded.bytes);
    line("\r\n");
  }
  line(`--${boundary}--\r\n`);
  return { boundary, body: Buffer.concat(chunks) };
}

async function publishPost(profile, post) {
  const content = [];
  if (post.title) content.push({ type: "text", text: post.title, subtype: "heading1" });
  const uploads = [];
  for (let index = 0; index < (post.media || []).length; index += 1) {
    const decoded = decodeDataUrl(post.media[index].data);
    if (!/^image\/(jpeg|png|gif|webp)$/.test(decoded.type)) {
      throw new Error(`Image ${index + 1} uses an unsupported format.`);
    }
    const identifier = `queue-studio-image-${index}`;
    const size = nativeImage.createFromBuffer(decoded.bytes).getSize();
    const media = {
      type: decoded.type,
      identifier
    };
    if (size.width > 0 && size.height > 0) {
      media.width = size.width;
      media.height = size.height;
    }
    content.push({
      type: "image",
      media: [media]
    });
    uploads.push({ identifier, decoded, name: safeUploadName(post.media[index].name, index, decoded.type) });
  }
  if (post.caption) content.push({ type: "text", text: post.caption });
  if (!content.length) throw new Error("The post has no text or images.");
  const state = post.state === "scheduled" ? "queue" : post.state;
  const payload = {
    content,
    state,
    tags: normalizeTags(post.tags).join(",")
  };
  if (post.state === "scheduled") {
    if (!post.schedule) throw new Error("A scheduled post needs a date and time.");
    payload.publish_on = new Date(post.schedule).toISOString();
  }
  const endpoint = `https://api.tumblr.com/v2/blog/${percentEncode(profile.blog)}/posts`;
  const response = await submitNpfPost(profile, "POST", endpoint, payload, uploads);
  return response;
}

async function submitNpfPost(profile, method, endpoint, payload, uploads) {
  if (!uploads.length) {
    return tumblrRequest(profile, method, endpoint, {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }
  const multipart = multipartPostBody(payload, uploads);
  return tumblrRequest(profile, method, endpoint, {
    headers: {
      "Content-Type": `multipart/form-data; boundary=${multipart.boundary}`,
      "Content-Length": String(multipart.body.length)
    },
    body: multipart.body
  });
}

function settingsPath() {
  return path.join(app.getPath("userData"), "connection.json");
}

function browserCandidates() {
  const local = process.env.LOCALAPPDATA || "";
  const programs = process.env.PROGRAMFILES || "";
  const programsX86 = process.env["PROGRAMFILES(X86)"] || "";
  return {
    brave: [
      path.join(programs, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      path.join(programsX86, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      path.join(local, "BraveSoftware", "Brave-Browser", "Application", "brave.exe")
    ],
    firefox: [
      path.join(programs, "Mozilla Firefox", "firefox.exe"),
      path.join(programsX86, "Mozilla Firefox", "firefox.exe")
    ],
    zen: [
      path.join(local, "Programs", "zen", "zen.exe"),
      path.join(local, "Programs", "Zen Browser", "zen.exe"),
      path.join(programs, "Zen Browser", "zen.exe")
    ],
    chrome: [
      path.join(programs, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programsX86, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(local, "Google", "Chrome", "Application", "chrome.exe")
    ]
  };
}

function findBrowserExecutable(browserName) {
  return (browserCandidates()[browserName] || []).find((candidate) =>
    candidate && fs.existsSync(candidate)) || null;
}

async function launchBrowser(browserName, url) {
  if (!isTumblrAuthorizationUrl(url)) {
    throw new Error("Qu will only open Tumblr authorization links.");
  }
  if (!browserName || browserName === "default") {
    await shell.openExternal(url);
    return;
  }
  const executable = findBrowserExecutable(browserName);
  if (!executable) throw new Error(`${browserName} was not found in its usual Windows location.`);
  const child = spawn(executable, [url], { detached: true, stdio: "ignore" });
  child.unref();
}

function readConnections() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    if (Array.isArray(saved.profiles)) return saved;
    if (saved.key && saved.blog) {
      return {
        activeId: "migrated-account",
        profiles: [{
          id: "migrated-account",
          name: saved.blog,
          key: saved.key,
          blog: saved.blog,
          secret: saved.secret,
          encrypted: saved.encrypted
        }]
      };
    }
  } catch {
    // Start with an empty account collection.
  }
  return { activeId: null, profiles: [] };
}

function writeConnections(settings) {
  fs.writeFileSync(settingsPath(), JSON.stringify(settings), { mode: 0o600 });
}

function saveConnection(connection) {
  const settings = readConnections();
  const existingIndex = connection.id
    ? settings.profiles.findIndex((profile) => profile.id === connection.id)
    : -1;
  if (existingIndex < 0 && settings.profiles.length >= 4) {
    return { ok: false, message: "Qu supports up to four Tumblr accounts." };
  }
  const existing = existingIndex >= 0 ? settings.profiles[existingIndex] : null;
  const secret = connection.secret
    ? (safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(connection.secret).toString("base64") : "")
    : existing?.secret || "";
  const profile = {
    id: existingIndex >= 0 ? connection.id : crypto.randomUUID(),
    name: connection.name,
    key: connection.key || existing?.key || "",
    blog: connection.blog,
    secret,
    callback: connection.callback || "",
    accessToken: connection.accessToken ? encrypt(connection.accessToken) :
      (existingIndex >= 0 ? settings.profiles[existingIndex].accessToken || "" : ""),
    accessTokenSecret: connection.accessTokenSecret ? encrypt(connection.accessTokenSecret) :
      (existingIndex >= 0 ? settings.profiles[existingIndex].accessTokenSecret || "" : ""),
    refreshToken: existingIndex >= 0 ? settings.profiles[existingIndex].refreshToken || "" : "",
    tokenExpiresAt: existingIndex >= 0 ? settings.profiles[existingIndex].tokenExpiresAt || 0 : 0,
    authMode: existingIndex >= 0 ? settings.profiles[existingIndex].authMode || "oauth1" : "oauth1",
    verifiedBlog: existingIndex >= 0 ? settings.profiles[existingIndex].verifiedBlog || null : null,
    queueTimes: existingIndex >= 0
      ? normalizedTimes(settings.profiles[existingIndex].queueTimes)
      : normalizedTimes(),
    encrypted: Boolean(secret)
  };
  if (existingIndex >= 0) settings.profiles[existingIndex] = profile;
  else settings.profiles.push(profile);
  settings.activeId = profile.id;
  writeConnections(settings);
  return profile;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#0b0d12",
    icon: path.join(__dirname, "assets", "qu-icon.png"),
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  const sidebarState = { open: true, obscured: false, width: 480, provider: "chatgpt", loadedProvider: null, view: null, bounds: null };
  aiSidebars.set(win.id, sidebarState);
  win.on("resize", () => updateAiSidebarBounds(win));
  win.on("closed", () => {
    if (sidebarState.view && !sidebarState.view.webContents.isDestroyed()) sidebarState.view.webContents.close();
    aiSidebars.delete(win.id);
  });
  win.loadFile("index.html");
}

app.whenReady().then(() => {
  session.fromPartition(AI_PARTITION).setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  createWindow();
  startAutoUpdates(() => BrowserWindow.getAllWindows()[0]);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("choose-images", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "webp"] }]
  });
  if (result.canceled) return [];
  const mimeByExtension = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".gif": "image/gif", ".webp": "image/webp"
  };
  return result.filePaths.map((filePath) => {
    const mime = mimeByExtension[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    return {
      name: path.basename(filePath),
      data: `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`
    };
  });
});

ipcMain.handle("open-external", (_event, url) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url);
});

ipcMain.handle("ai-sidebar-state", (event) => {
  const state = aiStateFor(event.sender);
  return state ? { open: state.open, width: state.width, provider: state.provider } : null;
});

ipcMain.handle("ai-sidebar-open", (event, shouldOpen) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const state = win && aiSidebars.get(win.id);
  if (!win || !state) return null;
  state.open = Boolean(shouldOpen);
  if (state.open && !state.obscured) openAiSidebar(win, state);
  else if (!state.open) {
    if (state.view && win.contentView.children.includes(state.view)) win.contentView.removeChildView(state.view);
  }
  return { open: state.open, width: state.width, provider: state.provider };
});

ipcMain.handle("ai-sidebar-obscured", (event, obscured) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const state = win && aiSidebars.get(win.id);
  if (!win || !state) return false;
  state.obscured = Boolean(obscured);
  if (state.obscured) {
    if (state.view && win.contentView.children.includes(state.view)) win.contentView.removeChildView(state.view);
  } else if (state.open) {
    openAiSidebar(win, state);
  }
  return state.obscured;
});

ipcMain.handle("ai-sidebar-provider", (event, provider) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const state = win && aiSidebars.get(win.id);
  if (!win || !state || !AI_PROVIDERS[provider]) return null;
  state.provider = provider;
  state.open = true;
  if (!state.obscured) openAiSidebar(win, state);
  return { open: state.open, width: state.width, provider };
});

ipcMain.handle("ai-sidebar-width", (event, width) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const state = win && aiSidebars.get(win.id);
  if (!win || !state) return null;
  state.width = Math.max(360, Math.min(720, Math.round(Number(width) || 480)));
  updateAiSidebarBounds(win);
  return state.width;
});

ipcMain.handle("ai-sidebar-bounds", (event, bounds) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const state = win && aiSidebars.get(win.id);
  if (!win || !state || !bounds) return false;
  const [contentWidth, contentHeight] = win.getContentSize();
  const clean = {
    x: Number(bounds.x) || 0, y: Number(bounds.y) || 0,
    width: Math.max(320, Math.min(contentWidth, Number(bounds.width) || 0)),
    height: Math.max(320, Math.min(contentHeight, Number(bounds.height) || 0))
  };
  state.bounds = clean;
  updateAiSidebarBounds(win);
  return true;
});

ipcMain.handle("ai-sidebar-reload", (event) => {
  const state = aiStateFor(event.sender);
  if (state?.view && !state.view.webContents.isDestroyed()) state.view.webContents.reload();
});

ipcMain.handle("ai-sidebar-open-external", (event) => {
  const state = aiStateFor(event.sender);
  if (state) shell.openExternal(AI_PROVIDERS[state.provider].url);
});

ipcMain.handle("available-browsers", () => {
  const found = {};
  for (const name of ["brave", "firefox", "zen", "chrome"]) {
    found[name] = Boolean(findBrowserExecutable(name));
  }
  return found;
});

ipcMain.handle("launch-auth-browser", async (_event, browserName, url) => {
  try {
    await launchBrowser(browserName, url);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle("save-connection", (_event, connection) => {
  if (!connection?.name?.trim() || !connection?.blog?.trim()) {
    return { ok: false, message: "Enter a profile name and Tumblr blog name." };
  }
  const saved = saveConnection({
    id: connection.id || null,
    name: connection.name.trim(),
    key: connection.key.trim(),
    secret: connection.secret,
    blog: connection.blog.trim(),
    callback: connection.callback?.trim() || "",
    accessToken: connection.accessToken?.trim() || "",
    accessTokenSecret: connection.accessTokenSecret?.trim() || ""
  });
  if (saved.ok === false) return saved;
  return { ok: true, profile: {
    id: saved.id, name: saved.name, blog: saved.blog,
    authorized: Boolean(saved.accessToken && (saved.authMode === "oauth2" || saved.accessTokenSecret)),
    verified: Boolean(saved.verifiedBlog)
  } };
});

ipcMain.handle("connection-status", () => {
  const saved = readConnections();
  return {
    activeId: saved.activeId,
    profiles: saved.profiles.map(({ id, name, blog, encrypted, accessToken, accessTokenSecret, authMode, verifiedBlog }) => ({
      id, name, blog, configured: Boolean(encrypted),
      authorized: Boolean(accessToken && (authMode === "oauth2" || accessTokenSecret)),
      verified: Boolean(verifiedBlog)
    }))
  };
});

ipcMain.handle("begin-authorization", async (_event, id) => {
  try {
    const settings = readConnections();
    const profile = settings.profiles.find((item) => item.id === id);
    if (!profile) return { ok: false, message: "Save this account profile first." };
    const response = await fetchWithTimeout(`${OAUTH_SERVICE_URL}/v2/oauth/start`, {
      method: "POST",
      headers: { "User-Agent": "Qu/0.8.8", "Cache-Control": "no-cache" }
    });
    const values = await response.json();
    if (!response.ok || !values.authorizeUrl || !values.sessionId || !values.sessionKey) {
      throw new Error(values.error || `Authorization service returned ${response.status}.`);
    }
    authorizationSessions.set(id, {
      sessionId: values.sessionId,
      sessionKey: values.sessionKey,
      createdAt: Date.now()
    });
    return { ok: true, authorizeUrl: values.authorizeUrl, automatic: true };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle("complete-authorization", async (_event, id) => {
  try {
    const pending = authorizationSessions.get(id);
    if (!pending || Date.now() - pending.createdAt > 15 * 60 * 1000) {
      throw new Error("The temporary authorization expired. Start authorization again.");
    }
    const response = await fetchWithTimeout(
      `${OAUTH_SERVICE_URL}/v1/oauth/session/${pending.sessionId}`,
      { headers: { Authorization: `Bearer ${pending.sessionKey}`, "User-Agent": "Qu/0.8.8" } }
    );
    const values = await response.json();
    if (response.ok && values.status === "pending") return { ok: true, pending: true };
    if (!response.ok || values.status !== "complete" || !values.accessToken) {
      throw new Error(values.message || values.error || "Tumblr authorization did not complete.");
    }
    const settings = readConnections();
    const profile = settings.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Account profile not found.");
    profile.accessToken = encrypt(values.accessToken);
    profile.accessTokenSecret = encrypt(values.accessTokenSecret || "");
    profile.refreshToken = encrypt(values.refreshToken || "");
    profile.tokenExpiresAt = values.expiresIn
      ? Date.now() + Math.max(0, Number(values.expiresIn) * 1000)
      : 0;
    profile.authMode = values.authMode || (values.accessTokenSecret ? "oauth1" : "oauth2");
    profile.verifiedBlog = null;
    writeConnections(settings);
    authorizationSessions.delete(id);
    const verified = await verifyProfile(profile);
    profile.verifiedBlog = verified;
    writeConnections(settings);
    return { ok: true, verified };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle("complete-pasted-callback", async (_event, callbackUrl) => {
  try {
    const values = extractTumblrCallbackParameters(callbackUrl);
    if (!values) throw new Error("Paste the complete Tumblr callback URL containing oauth_token and oauth_verifier.");
    const endpoint = new URL(`${OAUTH_SERVICE_URL}/v1/oauth/callback`);
    endpoint.searchParams.set("oauth_token", values.oauthToken);
    endpoint.searchParams.set("oauth_verifier", values.oauthVerifier);
    const response = await fetchWithTimeout(endpoint.toString(), {
      headers: { "User-Agent": "Qu/0.8.8", "Cache-Control": "no-cache" }
    });
    if (!response.ok) {
      const body = await response.text();
      const message = body.match(/<p>([^<]+)<\/p>/i)?.[1] || `Authorization service returned ${response.status}.`;
      throw new Error(message);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle("verify-connection", async (_event, id) => {
  try {
    const settings = readConnections();
    const profile = settings.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Account profile not found.");
    const verified = await verifyProfile(profile);
    profile.verifiedBlog = verified;
    writeConnections(settings);
    return { ok: true, verified };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle("queue-status", async (_event, id) => {
  try {
    const settings = readConnections();
    const profile = settings.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Select a connected Tumblr account.");
    return { ok: true, ...(await queueStatus(profile)) };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle("calendar-posts", async (_event, id) => {
  try {
    const settings = readConnections();
    const profile = settings.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Select a connected Tumblr account.");
    await verifyProfile(profile);
    return { ok: true, ...(await calendarPosts(profile)) };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle("save-queue-times", (_event, id, times) => {
  const settings = readConnections();
  const profile = settings.profiles.find((item) => item.id === id);
  if (!profile) return { ok: false, message: "Select a connected Tumblr account." };
  if (!Array.isArray(times) || times.some((value) => !/^\d{2}:\d{2}$/.test(value))) {
    return { ok: false, message: "Every Qu schedule slot needs a valid time." };
  }
  const normalized = normalizedTimes(times);
  if (normalized.length !== times.length) {
    return { ok: false, message: "Each Qu posting time must be different." };
  }
  if (normalized.length < 1 || normalized.length > 50) {
    return { ok: false, message: "Choose between 1 and 50 daily Qu posting times." };
  }
  profile.queueTimes = normalized;
  writeConnections(settings);
  return { ok: true, times: normalized };
});

ipcMain.handle("publish-posts", async (_event, id, posts) => {
  const settings = readConnections();
  const profile = settings.profiles.find((item) => item.id === id);
  if (!profile) return { ok: false, message: "Select a connected Tumblr account." };
  try {
    await verifyProfile(profile);
  } catch (error) {
    return { ok: false, message: `Account verification failed: ${error.message}` };
  }
  let automaticSlots = [];
  try {
    const queued = (posts || []).filter((post) => post.state === "qu-schedule");
    if (queued.length) {
      const status = await queueStatus(profile);
      const after = status.lastSlot ? new Date(status.lastSlot) : new Date();
      automaticSlots = queueSlots(profile.queueTimes, queued.length, after);
    }
  } catch (error) {
    return { ok: false, message: `Could not read Tumblr’s queue: ${error.message}` };
  }
  const results = [];
  let automaticSlotIndex = 0;
  for (const post of posts || []) {
    try {
      const prepared = { ...post };
      if (prepared.state === "qu-schedule" && automaticSlots[automaticSlotIndex]) {
        prepared.state = "scheduled";
        prepared.schedule = automaticSlots[automaticSlotIndex].toISOString();
        automaticSlotIndex += 1;
      }
      const published = await publishPost(profile, prepared);
      results.push({
        id: post.id,
        ok: true,
        tumblrId: published?.response?.id || published?.response?.id_string || null
      });
    } catch (error) {
      results.push({ id: post.id, ok: false, message: error.message });
    }
  }
  return { ok: true, results };
});

ipcMain.handle("activate-connection", (_event, id) => {
  const saved = readConnections();
  if (!saved.profiles.some((profile) => profile.id === id)) return { ok: false };
  saved.activeId = id;
  writeConnections(saved);
  return { ok: true };
});

ipcMain.handle("remove-connection", (_event, id) => {
  const saved = readConnections();
  saved.profiles = saved.profiles.filter((profile) => profile.id !== id);
  if (saved.activeId === id) saved.activeId = saved.profiles[0]?.id || null;
  writeConnections(saved);
  return { ok: true, activeId: saved.activeId };
});
