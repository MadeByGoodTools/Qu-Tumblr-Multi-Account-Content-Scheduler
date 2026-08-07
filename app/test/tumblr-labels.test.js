// SPDX-License-Identifier: MPL-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeContentLabels, tumblrCommunityLabelPayload } = require("../tumblr-labels");

test("specific Tumblr labels automatically include Mature", () => {
  assert.deepEqual(normalizeContentLabels(["sexual-themes"]), ["mature", "sexual-themes"]);
});

test("Mature alone sends Tumblr's general label", () => {
  assert.deepEqual(tumblrCommunityLabelPayload(["mature"]), {
    has_community_label: true,
    community_label_categories: []
  });
});

test("specific labels use Tumblr's native category identifiers", () => {
  assert.deepEqual(tumblrCommunityLabelPayload([
    "mature", "drug-and-alcohol-addiction", "violence", "sexual-themes"
  ]), {
    has_community_label: true,
    community_label_categories: ["drug_use", "violence", "sexual_themes"]
  });
});

test("For Everyone omits Tumblr's mature-label fields", () => {
  assert.deepEqual(tumblrCommunityLabelPayload([]), {});
});
