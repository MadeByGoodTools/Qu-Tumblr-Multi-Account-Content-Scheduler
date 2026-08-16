// SPDX-License-Identifier: MPL-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const renderer = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
const index = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

test("Qu no longer presents unsupported Tumblr content-label controls", () => {
  assert.doesNotMatch(index, /name="content-label"/);
  assert.doesNotMatch(renderer, /contentLabel|MatureContentLabel|labelsConfirmed/);
});

test("queueing synchronizes the open editor before selecting ready posts", () => {
  const handler = renderer.slice(renderer.indexOf('$("#queue-all")'));
  assert.ok(handler.indexOf("syncActiveEditor()") < handler.indexOf("state.posts.filter"));
});
