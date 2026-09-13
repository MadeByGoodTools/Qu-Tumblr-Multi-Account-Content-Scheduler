// SPDX-License-Identifier: MPL-2.0
const CAPTION_SUBTYPES = new Set(["heading1", "heading2", "quirky", "quote", "chat"]);

function normalizeCaptionSubtype(value) {
  return CAPTION_SUBTYPES.has(value) ? value : "";
}

function normalizeLink(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function normalizeCaptionFormatting(text, formatting) {
  const length = String(text || "").length;
  if (!length || !Array.isArray(formatting)) return [];
  const normalized = [];
  for (const item of formatting) {
    const start = Math.max(0, Math.min(length, Number.isInteger(item?.start) ? item.start : -1));
    const end = Math.max(0, Math.min(length, Number.isInteger(item?.end) ? item.end : -1));
    if (start >= end) continue;
    if (item.type === "color" && /^#[0-9a-f]{6}$/i.test(item.hex || "")) {
      normalized.push({ start, end, type: "color", hex: item.hex.toLowerCase() });
    }
    if (item.type === "link") {
      const url = normalizeLink(item.url);
      if (url) normalized.push({ start, end, type: "link", url });
    }
  }
  return normalized.sort((a, b) => a.start - b.start || a.end - b.end || a.type.localeCompare(b.type));
}

module.exports = { normalizeCaptionSubtype, normalizeCaptionFormatting };
