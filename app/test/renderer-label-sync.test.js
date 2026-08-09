// SPDX-License-Identifier: MPL-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const renderer = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");

test("changing a content label immediately synchronizes an existing saved post", () => {
  assert.match(renderer, /addEventListener\("change",\(\)=>\{syncMatureContentLabel\(input\);syncActiveEditor\(\)\}\)/);
});

test("queueing synchronizes the open editor before selecting ready posts", () => {
  const handler = renderer.slice(renderer.indexOf('$("#queue-all")'));
  assert.ok(handler.indexOf("syncActiveEditor()") < handler.indexOf("state.posts.filter"));
});
