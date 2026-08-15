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

function tumblrPostCommunityLabelState(post) {
  const labels = post?.community_labels || post?.communityLabels || {};
  const categories = labels.categories || post?.community_label_categories || post?.communityLabelCategories || [];
  const active = labels.has_community_label ?? labels.hasCommunityLabel ??
    post?.has_community_label ?? post?.hasCommunityLabel ?? false;
  return {
    active: Boolean(active),
    categories: [...new Set((Array.isArray(categories) ? categories : [])
      .map((category) => String(category || "").trim())
      .filter(Boolean))].sort()
  };
}

function tumblrPostHasContentLabels(post, labels) {
  const expected = tumblrCommunityLabelPayload(labels);
  if (!expected.has_community_label) return true;
  const actual = tumblrPostCommunityLabelState(post);
  const categories = [...expected.community_label_categories].sort();
  return actual.active && categories.length === actual.categories.length &&
    categories.every((category, index) => category === actual.categories[index]);
}

module.exports = {
  normalizeContentLabels,
  tumblrCommunityLabelPayload,
  tumblrPostCommunityLabelState,
  tumblrPostHasContentLabels
};
