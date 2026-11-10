import { importStatblock, foundryResolver } from "./statblock-parser.mjs";
import { createEngine } from "./ocr.mjs";
import { readStatblockFile, fileKind, ACCEPT } from "./file-reader.mjs";

const ID = "bab-statblock-importer";
const t = (k, d) => (d ? game.i18n.format(`BABSB.${k}`, d) : game.i18n.localize(`BABSB.${k}`));
const esc = s => foundry.utils.escapeHTML?.(String(s)) ?? String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

let engine = null;
const setting = k => game.settings.get(ID, k);
function getEngine() {
  let workerOptions = {};
  try { const raw = setting("tesseractOptions"); if (raw?.trim()) workerOptions = JSON.parse(raw); }
  catch (e) { ui.notifications.warn(t("BadOptions", { error: e.message })); }
  return (engine ??= createEngine({
    urls: { pdfJs: setting("pdfJsUrl"), pdfWorker: setting("pdfWorkerUrl"), tesseract: setting("tesseractUrl"), tesseractLang: setting("tesseractLangUrl") || null },
    workerOptions,
  }));
}

/** Parse text and create the actor. Returns { actor, warnings } or null. */
async function importText(text, { render = true } = {}) {
  if (!text?.trim()) { ui.notifications.warn(t("Empty")); return null; }
  let result;
  try {
    result = importStatblock(text, { resolver: await foundryResolver() });
  } catch (err) {
    console.error(`${ID} |`, err);
    ui.notifications.error(t("Failed", { error: err.message }));
    return null;
  }
  const doc = await Actor.create(result.actor);
  ui.notifications.info(t("Created", { name: doc.name }));
  if (result.warnings.length) {
    console.warn(`${ID} | ${doc.name}`, result.warnings);
    await foundry.applications.api.DialogV2.prompt({
      window: { title: t("WarnTitle") },
      content: `<p>${t("WarnBody")}</p><ul>${result.warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul>`,
      ok: { label: "OK" },
    });
  }
  if (render) doc.sheet.render(true);
  return { actor: doc, warnings: result.warnings };
}

/** Read an uploaded File (text, PDF or image) into statblock text. */
async function readFile(file, onStatus) {
  return readStatblockFile(file, { engine: getEngine(), onStatus });
}

/** Wire up the dialog once it is in the DOM (found by its data attribute, so no reliance on DialogV2 render options). */
function wireDialog(root) {
  if (root.dataset.wired) return;
  root.dataset.wired = "1";
  const area = root.querySelector("textarea[name=statblock]");
  const status = root.querySelector(".bab-sb-status");
  const input = root.querySelector("input[type=file]");
  const okBtn = root.closest(".application")?.querySelector("button[data-action=ok]");
  const setStatus = (msg, cls = "") => { status.textContent = msg; status.className = `bab-sb-status ${cls}`; };

  async function handle(file) {
    if (!file) return;
    if (!fileKind(file)) { setStatus(t("Unsupported", { name: file.name }), "error"); return; }
    if (okBtn) okBtn.disabled = true;
    area.disabled = true;
    try {
      const { text, source, dropped, notes } = await readFile(file, msg => setStatus(msg));
      area.value = text;
      const ocr = source === "ocr" || source === "pdf-ocr";
      setStatus((ocr ? t("ReadOcr", { lines: text.split("\n").length, dropped: dropped.length }) : t("ReadOk", { name: file.name })) + (notes?.length ? " " + t("ReadNotes", { notes: notes.join("; ") }) : ""), ocr ? "warn" : "ok");
    } catch (err) {
      console.error(`${ID} |`, err);
      setStatus(t("ReadFailed", { error: err.message }), "error");
    } finally {
      area.disabled = false;
      if (okBtn) okBtn.disabled = false;
    }
  }

  input.addEventListener("change", () => { handle(input.files[0]); input.value = ""; });
  for (const ev of ["dragenter", "dragover"]) root.addEventListener(ev, e => { e.preventDefault(); root.classList.add("dragging"); });
  for (const ev of ["dragleave", "drop"]) root.addEventListener(ev, e => { e.preventDefault(); root.classList.remove("dragging"); });
  root.addEventListener("drop", e => handle(e.dataTransfer?.files?.[0]));
  area.addEventListener("paste", e => {
    const f = [...(e.clipboardData?.files ?? [])].find(x => fileKind(x));
    if (f) { e.preventDefault(); handle(f); }
  });
}

Hooks.on("renderDialogV2", (app, el) => {
  const root = (el instanceof HTMLElement ? el : el[0])?.querySelector?.("[data-bab-statblock]");
  if (root) wireDialog(root);
});

async function openDialog() {
  const data = await foundry.applications.api.DialogV2.prompt({
    window: { title: t("Title"), resizable: true },
    position: { width: 580 },
    content: `<div data-bab-statblock class="bab-sb">
      <style>
        .bab-sb.dragging textarea { outline: 2px dashed var(--color-warm-2, #c60); }
        .bab-sb-status { margin: .3em 0; min-height: 1.4em; font-size: var(--font-size-12, 12px); }
        .bab-sb-status.ok { color: var(--color-level-success, #080); }
        .bab-sb-status.warn { color: var(--color-warm-3, #a50); }
        .bab-sb-status.error { color: var(--color-level-error, #c00); }
      </style>
      <div class="form-group"><label>${t("File")}</label><div class="form-fields"><input type="file" accept="${ACCEPT}"></div><p class="hint">${t("FileHint")}</p></div>
      <p class="bab-sb-status" role="status" aria-live="polite"></p>
      <div class="form-group stacked"><textarea name="statblock" rows="20" style="width:100%;font-family:monospace" placeholder="${esc(t("Placeholder"))}"></textarea></div>
      <div class="form-group"><label><input type="checkbox" name="open" checked> ${t("OpenSheet")}</label></div>
    </div>`,
    ok: { label: t("Import"), icon: "fa-solid fa-file-import", callback: (ev, button) => ({ text: button.form.elements.statblock.value, open: button.form.elements.open.checked }) },
    rejectClose: false,
  });
  await engine?.dispose(); engine = null;   // free the OCR worker
  if (data) await importText(data.text, { render: data.open });
}

const DEFAULT_URLS = {
  pdfJsUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs",
  pdfWorkerUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs",
  tesseractUrl: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
  tesseractLangUrl: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int",
};

Hooks.once("init", () => {
  for (const [key, def] of Object.entries(DEFAULT_URLS))
    game.settings.register(ID, key, { name: `BABSB.Setting.${key}.Name`, hint: `BABSB.Setting.${key}.Hint`, scope: "world", config: true, type: String, default: def });
  game.settings.register(ID, "tesseractOptions", { name: "BABSB.Setting.tesseractOptions.Name", hint: "BABSB.Setting.tesseractOptions.Hint", scope: "world", config: true, type: String, default: "" });
  game.modules.get(ID).api = {
    importText, openDialog, readFile,
    /** Upload helper for macros: importFile(file) -> actor result */
    importFile: async (file, opts) => { const { text } = await readFile(file); await engine?.dispose(); engine = null; return importText(text, opts); },
  };
});

// Actors sidebar button (v13+ ApplicationV2 sidebar)
Hooks.on("renderActorDirectory", (app, html) => {
  if (!game.user.can("ACTOR_CREATE")) return;
  const root = html instanceof HTMLElement ? html : html[0];
  if (root.querySelector(".bab-statblock-import")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "bab-statblock-import";
  btn.innerHTML = `<i class="fa-solid fa-file-import"></i> ${t("Button")}`;
  btn.addEventListener("click", openDialog);
  (root.querySelector(".header-actions") ?? root.querySelector(".directory-header"))?.append(btn);
});
