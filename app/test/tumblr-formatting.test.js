// SPDX-License-Identifier: MPL-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeCaptionSubtype, normalizeCaptionFormatting } = require("../tumblr-formatting");

test("keeps Tumblr-native caption styles", () => {
  assert.equal(normalizeCaptionSubtype("quirky"), "quirky");
  assert.equal(normalizeCaptionSubtype("heading2"), "heading2");
  assert.equal(normalizeCaptionSubtype("Comic Sans"), "");
});

test("keeps valid Tumblr colors and web hyperlinks", () => {
  assert.deepEqual(normalizeCaptionFormatting("Read this", [
    { start: 0, end: 4, type: "color", hex: "#FF492F" },
    { start: 5, end: 9, type: "link", url: "https://goodtools.ca/qu" }
  ]), [
    { start: 0, end: 4, type: "color", hex: "#ff492f" },
    { start: 5, end: 9, type: "link", url: "https://goodtools.ca/qu" }
  ]);
});

test("drops unsafe links and clamps ranges to the caption", () => {
  assert.deepEqual(normalizeCaptionFormatting("Hello", [
    { start: 0, end: 50, type: "color", hex: "#72A7FF" },
    { start: 0, end: 5, type: "link", url: "javascript:alert(1)" }
  ]), [{ start: 0, end: 5, type: "color", hex: "#72a7ff" }]);
});

test("publishing attaches the normalized style and formatting to the Tumblr text block", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.match(main, /normalizeCaptionSubtype\(post\.captionSubtype\)/);
  assert.match(main, /normalizeCaptionFormatting\(post\.caption, post\.captionFormatting\)/);
  assert.match(main, /caption\.formatting = formatting/);
});
