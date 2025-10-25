import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

/**
 * Utility to check whether `obj` contains the path given in dot notation.
 * Supports simple arrays indexed like "items.0.name".
 */
function hasPath(obj, path) {
  if (!path) return false;
  const parts = String(path).split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur === undefined || cur === null) return false;
    // If numeric index, treat as array index
    if (/^\d+$/.test(p)) {
      const idx = parseInt(p, 10);
      if (!Array.isArray(cur) || idx < 0 || idx >= cur.length) return false;
      cur = cur[idx];
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(cur, p)) {
      cur = cur[p];
      continue;
    }
    return false;
  }
  return true;
}

/**
 * extractTemplateTags(buffer) -> returns array of tag names found in template
 */
export function extractTemplateTags(buffer) {
  try {
    const zip = new PizZip(buffer);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
    const tagMap = typeof doc.getTags === 'function' ? doc.getTags() : {};
    return Object.keys(tagMap || {});
  } catch (err) {
    // Re-throw with context for the caller to handle
    const e = new Error(`Failed to extract tags from template: ${err.message}`);
    e.original = err;
    throw e;
  }
}

/**
 * validateDataAgainstTemplate(buffer, data) -> { tags: [], missing: [] }
 * - tags: all placeholders found in template (cleaned)
 * - missing: placeholders not satisfied by provided data
 */
export function validateDataAgainstTemplate(buffer, data = {}) {
  const tags = extractTemplateTags(buffer);
  const missing = [];
  for (const tag of tags) {
    // Clean tag of filters and whitespace, e.g. "person.name | upper" -> "person.name"
    const cleaned = String(tag).split('|')[0].trim();
    // Some docxtemplater tags include braces or other punctuation; keep it simple
    if (!hasPath(data, cleaned)) {
      missing.push(cleaned);
    }
  }
  return { tags, missing };
}
