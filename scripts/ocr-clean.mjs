/**
 * Tidy raw OCR output of a statblock image so statblock-parser can read it.
 * Pure function (Node + browser). It never invents data: it only drops noise, fixes the title's case,
 * normalises section headers and removes blank lines (OCR puts one between nearly every line).
 */
const SIZE_LINE = /^(Tiny|Small|Medium|Large|Huge|Gargantuan)\b[^,]*,\s*\S/i;
const SECTION = /^(traits|actions|bonus actions|reactions|legendary actions|lair actions|mythic actions)$/i;
const SMALL = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);

export const titleCase = s => s.toLowerCase().split(/\s+/).filter(Boolean)
  .map((w, i) => (i > 0 && SMALL.has(w) ? w : w.replace(/^([^a-z0-9]*)([a-z])/, (m, a, b) => a + b.toUpperCase()))).join(" ");

/** Edit-distance-1 test restricted to OCR-typical slips: one substitution, or one letter dropped from a doubled letter. */
function ocrSlip(a, b) {
  if (a === b) return false;
  if (a.length === b.length) { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++d > 1) return false; return d === 1; }
  if (Math.abs(a.length - b.length) !== 1) return false;
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  for (let i = 0; i < long.length; i++) if (long.slice(0, i) + long.slice(i + 1) === short) return long[i] === long[i - 1] || long[i] === long[i + 1];
  return false;
}

/** Small caps confuse OCR ("Mimmic", "Ruc"). The creature is usually named again in the body, so fix near-misses from that. */
const STOP3 = new Set(["the", "and", "can", "has", "its", "one", "two", "any", "are", "not", "for", "hit", "who", "may", "all", "out", "own", "per", "use", "see", "dis", "via", "ft"]);
export function fixTitle(title, bodyText) {
  const notes = [];
  const bodyWords = [...new Set(bodyText.toLowerCase().match(/[a-z]{3,}/g) ?? [])];
  const titleWords = title.toLowerCase().split(/\s+/);
  const out = title.split(/\s+/).map(word => {
    let w = word.replace(/([a-zA-Z])\1{2,}/gi, "$1$1");                   // "Pumpppkin" -> "Pumppkin" (3+ identical letters are OCR noise)
    const lw = w.toLowerCase();
    if (lw.length >= 3 && !bodyWords.includes(lw)) {
      const hits = bodyWords.filter(b => !titleWords.includes(b) && !(b.length === 3 && STOP3.has(b)) && ocrSlip(lw, b));
      if (hits.length === 1) w = w[0] === w[0].toUpperCase() ? hits[0][0].toUpperCase() + hits[0].slice(1) : hits[0];
    }
    if (w !== word) notes.push(`Title word "${word}" read as "${w}"`);
    return w;
  });
  return { title: out.join(" "), notes };
}

export function cleanOcrText(raw) {
  const dropped = [];
  let lines = raw.replace(/\r/g, "").split("\n").map(l => l.trim()).filter(Boolean).filter(l => {
    const alnum = (l.match(/[A-Za-z0-9]/g) ?? []).length;
    const junk = /[—–_=~]{3,}|-{3,}/.test(l)          // horizontal rules read as dashes
      || /[|\[\]{}]/.test(l)                          // pipes/brackets never occur in statblocks
      || (alnum <= 3 && !/\d/.test(l) && !/^[a-z]/.test(l));   // specks like "EE ——" (a lone wrapped "it." is kept)
    if (junk) dropped.push(l);
    return !junk;
  });
  const notes = [];
  // Title: the line just before "Medium undead, unaligned". Small caps confuse OCR, so normalise case and check it against the body.
  const typeIdx = lines.findIndex(l => SIZE_LINE.test(l));
  if (typeIdx > 0) {
    const fixed = fixTitle(titleCase(lines[typeIdx - 1]), lines.slice(typeIdx).join(" "));
    notes.push(...fixed.notes);
    lines = [fixed.title, ...lines.slice(typeIdx)];
  }
  lines = lines.map(l => (SECTION.test(l) ? titleCase(l) : l));
  return { text: lines.join("\n"), dropped, notes };
}
