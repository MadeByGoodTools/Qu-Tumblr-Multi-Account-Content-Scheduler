// SPDX-License-Identifier: MPL-2.0
function isTumblrAuthorizationUrl(value) {
  try {
    const url = new URL(value);
    const tumblrHost = url.hostname === "tumblr.com" || url.hostname === "www.tumblr.com";
    return url.protocol === "https:" && tumblrHost &&
      (url.pathname === "/oauth/authorize" || url.pathname === "/oauth2/authorize");
  } catch {
    return false;
  }
}

function extractTumblrCallbackParameters(value) {
  try {
    const url = new URL(value);
    const allowedHost = url.hostname.endsWith(".tumblr.com") || url.hostname === "madebygoodtools.github.io";
    const oauthToken = url.searchParams.get("oauth_token");
    const oauthVerifier = url.searchParams.get("oauth_verifier");
    if (url.protocol !== "https:" || !allowedHost || !oauthToken || !oauthVerifier) return null;
    return { oauthToken, oauthVerifier };
  } catch {
    return null;
  }
}

module.exports = { isTumblrAuthorizationUrl, extractTumblrCallbackParameters };
