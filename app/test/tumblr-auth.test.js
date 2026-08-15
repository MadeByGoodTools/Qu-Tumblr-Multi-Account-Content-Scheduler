// SPDX-License-Identifier: MPL-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const { isTumblrAuthorizationUrl } = require("../tumblr-auth");

test("accepts Tumblr OAuth 2 authorization URLs", () => {
  assert.equal(isTumblrAuthorizationUrl("https://www.tumblr.com/oauth2/authorize?client_id=test"), true);
});

test("accepts Tumblr OAuth 1 authorization URLs", () => {
  assert.equal(isTumblrAuthorizationUrl("https://www.tumblr.com/oauth/authorize?oauth_token=test"), true);
});

test("rejects lookalike and non-authorization URLs", () => {
  assert.equal(isTumblrAuthorizationUrl("https://tumblr.example/oauth2/authorize"), false);
  assert.equal(isTumblrAuthorizationUrl("https://www.tumblr.com/dashboard"), false);
  assert.equal(isTumblrAuthorizationUrl("javascript:alert(1)"), false);
});
