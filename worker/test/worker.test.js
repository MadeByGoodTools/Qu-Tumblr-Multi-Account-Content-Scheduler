import test from "node:test";
import assert from "node:assert/strict";
import { testables } from "../src/worker.js";

test("OAuth percent encoding follows RFC 5849", () => {
  assert.equal(testables.percentEncode("Ladies + Gentlemen"), "Ladies%20%2B%20Gentlemen");
  assert.equal(testables.percentEncode("!*'()"), "%21%2A%27%28%29");
});

test("constant-time comparison rejects different values", () => {
  assert.equal(testables.timingSafeEqual("same", "same"), true);
  assert.equal(testables.timingSafeEqual("same", "other"), false);
  assert.equal(testables.timingSafeEqual("short", "longer"), false);
});

test("Tumblr form responses are parsed", () => {
  assert.deepEqual(testables.parseTumblrResponse("oauth_token=one&oauth_token_secret=two"), {
    oauth_token: "one",
    oauth_token_secret: "two"
  });
});
