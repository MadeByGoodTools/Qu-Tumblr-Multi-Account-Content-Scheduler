const AUTHORIZE_URL = "https://www.tumblr.com/oauth2/authorize";
const ACCESS_TOKEN_URL = "https://api.tumblr.com/v2/oauth2/token";
const REGISTERED_CALLBACK_URL = "https://nullgurll.github.io/qu/oauth-callback.html";
const SESSION_TTL_SECONDS = 15 * 60;

const encoder = new TextEncoder();

function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function randomToken(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Array.from(data, (value) => value.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left, right) {
  const a = encoder.encode(String(left));
  const b = encoder.encode(String(right));
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function hmacSha1(key, value) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value));
  let binary = "";
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function oauthHeader({ method, url, consumerKey, consumerSecret, token, tokenSecret = "", extra = {} }) {
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: randomToken(16),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: "1.0",
    ...extra
  };
  if (token) oauth.oauth_token = token;
  const normalized = Object.entries(oauth)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${percentEncode(key)}=${percentEncode(value)}`)
    .join("&");
  const base = [method.toUpperCase(), percentEncode(url), percentEncode(normalized)].join("&");
  oauth.oauth_signature = await hmacSha1(
    `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`,
    base
  );
  return `OAuth ${Object.entries(oauth)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${percentEncode(key)}="${percentEncode(value)}"`)
    .join(", ")}`;
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders
    }
  });
}

function parseTumblrResponse(text) {
  return Object.fromEntries(new URLSearchParams(text));
}

function requireConfiguration(env) {
  if (!env.QU_OAUTH_SESSIONS || !env.TUMBLR_CONSUMER_KEY || !env.TUMBLR_CONSUMER_SECRET) {
    throw new Error("The Qu authorization service is not configured yet.");
  }
}

async function tumblrTokenRequest({ url, env, token, tokenSecret, extra, method = "POST" }) {
  const authorization = await oauthHeader({
    method,
    url,
    consumerKey: String(env.TUMBLR_CONSUMER_KEY).trim(),
    consumerSecret: String(env.TUMBLR_CONSUMER_SECRET).trim(),
    token,
    tokenSecret,
    extra
  });
  const response = await fetch(url, {
    method,
    headers: { Authorization: authorization, "User-Agent": "Qu OAuth Service/1.0" }
  });
  const values = parseTumblrResponse(await response.text());
  if (!response.ok || !values.oauth_token || !values.oauth_token_secret) {
    const detail = values.oauth_problem_advice || values.oauth_problem || values.error || `HTTP ${response.status}`;
    throw new Error(`Tumblr authorization failed: ${detail}`);
  }
  return values;
}

async function startAuthorization(request, env) {
  requireConfiguration(env);
  const sessionId = randomToken(24);
  const sessionKey = randomToken(32);
  const state = randomToken(32);
  const session = {
    status: "pending",
    sessionKey,
    state,
    createdAt: Date.now()
  };
  const authorizeUrl = new URL(AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_id", String(env.TUMBLR_CONSUMER_KEY).trim());
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "basic write offline_access");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("redirect_uri", REGISTERED_CALLBACK_URL);
  await Promise.all([
    env.QU_OAUTH_SESSIONS.put(`session:${sessionId}`, JSON.stringify(session), { expirationTtl: SESSION_TTL_SECONDS }),
    env.QU_OAUTH_SESSIONS.put(`state:${state}`, sessionId, { expirationTtl: SESSION_TTL_SECONDS })
  ]);
  return json({
    authorizeUrl: authorizeUrl.toString(),
    sessionId,
    sessionKey,
    expiresIn: SESSION_TTL_SECONDS
  }, 201);
}

function callbackPage(success, message) {
  const title = success ? "Tumblr connected" : "Connection failed";
  const safeMessage = String(message).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title} — Qu</title><style>body{margin:0;background:#0b0f14;color:#f7f8fa;font:16px system-ui;display:grid;min-height:100vh;place-items:center}.card{max-width:34rem;margin:2rem;padding:2.5rem;border:1px solid #28313d;border-radius:24px;background:#121820;box-shadow:0 24px 80px #0008}h1{margin-top:0;font-size:2rem;color:${success ? "#62e69a" : "#ff7b87"}}p{line-height:1.6;color:#cad1d9}</style><main class="card"><h1>${title}</h1><p>${safeMessage}</p><p>You may close this page and return to Qu.</p></main></html>`, {
    status: success ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY" }
  });
}

async function completeCallback(request, env) {
  requireConfiguration(env);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const returnedError = url.searchParams.get("error");
  if (returnedError) return callbackPage(false, url.searchParams.get("error_description") || returnedError);
  if (!code || !state) return callbackPage(false, "Tumblr did not return a complete authorization response.");
  const sessionId = await env.QU_OAUTH_SESSIONS.get(`state:${state}`);
  if (!sessionId) return callbackPage(false, "This authorization attempt expired. Please start again in Qu.");
  const session = await env.QU_OAUTH_SESSIONS.get(`session:${sessionId}`, "json");
  if (!session || !timingSafeEqual(session.state, state)) return callbackPage(false, "This authorization attempt is invalid or expired.");
  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: String(env.TUMBLR_CONSUMER_KEY).trim(),
      client_secret: String(env.TUMBLR_CONSUMER_SECRET).trim(),
      redirect_uri: REGISTERED_CALLBACK_URL
    });
    const response = await fetch(ACCESS_TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "Qu OAuth Service/2.0"
      },
      body
    });
    const values = await response.json();
    if (!response.ok || !values.access_token) {
      throw new Error(values.error_description || values.error || `Tumblr returned HTTP ${response.status}`);
    }
    await env.QU_OAUTH_SESSIONS.put(`session:${sessionId}`, JSON.stringify({
      status: "complete",
      sessionKey: session.sessionKey,
      accessToken: values.access_token,
      refreshToken: values.refresh_token || "",
      expiresIn: values.expires_in || 0,
      tokenType: values.token_type || "bearer",
      scope: values.scope || "",
      completedAt: Date.now()
    }), { expirationTtl: 5 * 60 });
    await env.QU_OAUTH_SESSIONS.delete(`state:${state}`);
    return callbackPage(true, "Authorization is complete. Qu will finish connecting this account automatically.");
  } catch (error) {
    await env.QU_OAUTH_SESSIONS.put(`session:${sessionId}`, JSON.stringify({
      status: "failed", sessionKey: session.sessionKey, message: error.message
    }), { expirationTtl: 5 * 60 });
    return callbackPage(false, error.message);
  }
}

async function refreshAuthorization(request, env) {
  requireConfiguration(env);
  const payload = await request.json().catch(() => ({}));
  if (!payload.refreshToken || typeof payload.refreshToken !== "string") {
    return json({ error: "A refresh token is required." }, 400);
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: payload.refreshToken,
    client_id: String(env.TUMBLR_CONSUMER_KEY).trim(),
    client_secret: String(env.TUMBLR_CONSUMER_SECRET).trim()
  });
  const response = await fetch(ACCESS_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "Qu OAuth Service/2.0" },
    body
  });
  const values = await response.json();
  if (!response.ok || !values.access_token) {
    return json({ error: values.error_description || values.error || `Tumblr returned HTTP ${response.status}` }, 400);
  }
  return json({
    accessToken: values.access_token,
    refreshToken: values.refresh_token || payload.refreshToken,
    expiresIn: values.expires_in || 0,
    tokenType: values.token_type || "bearer",
    scope: values.scope || ""
  });
}

async function pollSession(request, env, sessionId) {
  requireConfiguration(env);
  const authorization = request.headers.get("authorization") || "";
  const suppliedKey = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const session = await env.QU_OAUTH_SESSIONS.get(`session:${sessionId}`, "json");
  if (!session || !suppliedKey || !timingSafeEqual(session.sessionKey, suppliedKey)) {
    return json({ error: "Authorization session not found." }, 404);
  }
  if (session.status === "pending") return json({ status: "pending" });
  if (session.status === "failed") {
    await env.QU_OAUTH_SESSIONS.delete(`session:${sessionId}`);
    return json({ status: "failed", message: session.message }, 400);
  }
  if (session.status === "complete") {
    await env.QU_OAUTH_SESSIONS.delete(`session:${sessionId}`);
    return json({
      status: "complete",
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresIn: session.expiresIn,
      tokenType: session.tokenType,
      scope: session.scope
    });
  }
  return json({ error: "Invalid authorization state." }, 500);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") {
        const consumerKey = String(env.TUMBLR_CONSUMER_KEY || "").trim();
        const consumerSecret = String(env.TUMBLR_CONSUMER_SECRET || "").trim();
        return json({
          ok: true,
          service: "Qu Tumblr authorization",
          configured: Boolean(env.QU_OAUTH_SESSIONS && consumerKey && consumerSecret),
          oauthVersion: "2.0"
        });
      }
      if (request.method === "POST" && ["/v1/oauth/start", "/v2/oauth/start"].includes(url.pathname)) {
        return await startAuthorization(request, env);
      }
      if (request.method === "GET" && url.pathname === "/v1/oauth/callback") return await completeCallback(request, env);
      if (request.method === "POST" && url.pathname === "/v2/oauth/refresh") return await refreshAuthorization(request, env);
      const match = request.method === "GET" && url.pathname.match(/^\/v1\/oauth\/session\/([a-f0-9]{48})$/);
      if (match) return await pollSession(request, env, match[1]);
      return json({ error: "Not found." }, 404);
    } catch (error) {
      return json({ error: error.message || "Unexpected authorization service error." }, 500);
    }
  }
};

export const testables = { percentEncode, timingSafeEqual, oauthHeader, parseTumblrResponse };
