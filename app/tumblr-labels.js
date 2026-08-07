// SPDX-License-Identifier: MPL-2.0
const LABEL_CATEGORY_MAP = Object.freeze({
  "drug-and-alcohol-addiction": "drug_use",
  violence: "violence",
  "sexual-themes": "sexual_themes"
});

function normalizeContentLabels(labels) {
  const allowed = new Set(["mature", ...Object.keys(LABEL_CATEGORY_MAP)]);
  const result = [...new Set((Array.isArray(labels) ? labels : [])
    .map((label) => String(label || "").trim())
    .filter((label) => allowed.has(label)))];
  if (result.some((label) => label !== "mature") && !result.includes("mature")) {
    result.unshift("mature");
  }
  return result;
}

function tumblrCommunityLabelPayload(labels) {
  const normalized = normalizeContentLabels(labels);
  if (!normalized.length) return {};
  return {
    has_community_label: true,
    community_label_categories: normalized
      .filter((label) => label !== "mature")
      .map((label) => LABEL_CATEGORY_MAP[label])
  };
}

module.exports = { normalizeContentLabels, tumblrCommunityLabelPayload };
