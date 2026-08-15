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

module.exports = { isTumblrAuthorizationUrl };
