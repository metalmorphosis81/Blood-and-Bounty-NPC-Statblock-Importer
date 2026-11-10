/**
 * Turn an uploaded file into statblock text.
 *   text / markdown  -> as is
 *   PDF              -> text layer if present, otherwise each page is rendered and OCR'd
 *   image            -> OCR
 * `engine` is the object from createEngine() (injected so this stays testable).
 */
import { cleanOcrText } from "./ocr-clean.mjs";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
const TEXT_EXT = /\.(txt|md|markdown|text)$/i;
export const ACCEPT = ".txt,.md,.pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,image/*,application/pdf,text/plain";

export const fileKind = f =>
  /pdf/i.test(f.type) || /\.pdf$/i.test(f.name) ? "pdf"
  : /^image\//i.test(f.type) || IMAGE_EXT.test(f.name) ? "image"
  : /^text\//i.test(f.type) || TEXT_EXT.test(f.name) ? "text" : null;

/** Rebuild lines from pdf.js text items (grouped by baseline, left to right). */
export function pdfItemsToText(items) {
  const rows = [];
  for (const it of items) {
    if (!("str" in it) || !it.str.trim()) continue;
    const y = it.transform[5], x = it.transform[4];
    const row = rows.find(r => Math.abs(r.y - y) < 2.5);
    if (row) row.parts.push({ x, str: it.str, w: it.width ?? 0 }); else rows.push({ y, parts: [{ x, str: it.str, w: it.width ?? 0 }] });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map(r => {
    r.parts.sort((a, b) => a.x - b.x);
    return r.parts.reduce((out, p, i) => {
      if (i === 0) return p.str;
      const prev = r.parts[i - 1];
      const gap = p.x - (prev.x + prev.w);
      return out + (/\s$/.test(out) || /^\s/.test(p.str) || gap < 0.5 ? "" : " ") + p.str;
    }, "");
  }).join("\n");
}

export async function readStatblockFile(file, { engine, onStatus = () => {} } = {}) {
  const kind = fileKind(file);
  if (!kind) throw new Error(`Unsupported file type: ${file.name || file.type}. Use a .txt, .md, .pdf or image file.`);

  if (kind === "text") return { text: await file.text(), source: "text", dropped: [] };

  if (kind === "image") {
    onStatus("Reading image (OCR)…");
    const raw = await engine.ocrImage(file, p => p.status && onStatus(`OCR: ${p.status} ${p.progress ? Math.round(p.progress * 100) + "%" : ""}`));
    const { text, dropped, notes } = cleanOcrText(raw);
    return { text, source: "ocr", dropped, notes };
  }

  // PDF
  onStatus("Opening PDF…");
  const pdfjs = await engine.loadPdfjs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const layer = pdfItemsToText((await page.getTextContent()).items);
    if (layer.replace(/\s/g, "").length >= 60) { pages.push({ text: layer, ocr: false }); continue; }
    // scanned page: render then OCR
    onStatus(`Page ${n}/${pdf.numPages}: no text layer, running OCR…`);
    const viewport = page.getViewport({ scale: 3 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
    pages.push({ text: await engine.ocrImage(blob), ocr: true });
  }
  const anyOcr = pages.some(p => p.ocr);
  const joined = pages.map(p => p.text).join("\n");
  if (!anyOcr) return { text: joined, source: "pdf-text", dropped: [] };
  const { text, dropped, notes } = cleanOcrText(joined);
  return { text, source: "pdf-ocr", dropped, notes };
}
