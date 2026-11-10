/**
 * Browser-side OCR + PDF loading. Libraries are fetched lazily, on first use, from URLs set in the module settings.
 *   const engine = createEngine({ urls });
 *   await engine.ocrImage(blob, onProgress)  -> raw text
 *   await engine.loadPdfjs()                 -> pdf.js namespace
 */
const loadScript = src => new Promise((resolve, reject) => {
  const el = document.createElement("script");
  el.src = src; el.onload = resolve; el.onerror = () => reject(new Error(`Could not load ${src}`));
  document.head.append(el);
});

/** Upscale (~3x, min 1600px wide) and grayscale: small statblock images OCR far better this way. */
export async function preprocess(blob) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(4, Math.max(1, 2100 / bmp.width));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.filter = "grayscale(1) contrast(1.15)";
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); // flatten transparency
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error("Image conversion failed"))), "image/png"));
}

/**
 * urls: { pdfJs, pdfWorker, tesseract, tesseractLang? }   (module settings; CDN by default, nothing is bundled)
 * workerOptions: extra Tesseract createWorker options, e.g. { workerPath, corePath, langPath } to self-host for offline use.
 */
export function createEngine({ urls, workerOptions = {} }) {
  let workerPromise = null, pdfPromise = null, progressCb = null;

  async function getWorker() {
    workerPromise ??= (async () => {
      if (!globalThis.Tesseract) await loadScript(urls.tesseract);
      return globalThis.Tesseract.createWorker("eng", 1, {
        ...(urls.tesseractLang ? { langPath: urls.tesseractLang, gzip: true } : {}),
        ...workerOptions,
        logger: m => progressCb?.(m),
      });
    })();
    try { return await workerPromise; } catch (e) { workerPromise = null; throw e; }
  }

  return {
    async ocrImage(blob, onProgress) {
      progressCb = onProgress;
      const worker = await getWorker();
      const { data } = await worker.recognize(await preprocess(blob));
      return data.text;
    },
    async loadPdfjs() {
      pdfPromise ??= import(/* webpackIgnore: true */ urls.pdfJs).then(lib => {
        lib.GlobalWorkerOptions.workerSrc = urls.pdfWorker;
        return lib;
      });
      try { return await pdfPromise; } catch (e) { pdfPromise = null; throw new Error(`Could not load pdf.js from ${urls.pdfJs} (${e.message})`); }
    },
    async dispose() { if (workerPromise) { try { (await workerPromise).terminate(); } catch {} workerPromise = null; } },
  };
}
