/**
 * Statblock -> Foundry dnd5e NPC actor data.
 *
 * Environment-agnostic (Node and Foundry). Pure function core:
 *   const { actor, warnings, report } = buildActor(parseStatblock(text), { resolver });
 *
 * `resolver` (optional) is how compendium data is pulled in:
 *   resolver.findFeature(name) -> { name, img, pack, id, type } | null
 * - Node: nodeResolver(indexJson)       (index built from the dnd5e pack sources)
 * - Foundry: foundryResolver()          (reads game.packs "dnd5e.monsterfeatures24" / "dnd5e.monsterfeatures")
 *
 * Statblock-specific numbers (damage, DCs, bonuses, HP, ...) always come from the pasted text.
 * Compendium data is used only for things the text cannot supply: icons and stock rules references.
 */

// ---------------------------------------------------------------- constants
const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const ABILITY_NAMES = { strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha" };
const SIZES = { tiny: "tiny", small: "sm", medium: "med", large: "lg", huge: "huge", gargantuan: "grg" };
const TOKEN_DIM = { tiny: 0.5, sm: 1, med: 1, lg: 2, huge: 3, grg: 4 };
const CREATURE_TYPES = ["aberration", "beast", "celestial", "construct", "dragon", "elemental", "fey", "fiend", "giant", "humanoid", "monstrosity", "ooze", "plant", "undead"];
const DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
const CONDITIONS = ["blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"];
const SKILLS = {
  acrobatics: ["acr", "dex"], "animal handling": ["ani", "wis"], arcana: ["arc", "int"], athletics: ["ath", "str"],
  deception: ["dec", "cha"], history: ["his", "int"], insight: ["ins", "wis"], intimidation: ["itm", "cha"],
  investigation: ["inv", "int"], medicine: ["med", "wis"], nature: ["nat", "int"], perception: ["prc", "wis"],
  performance: ["prf", "cha"], persuasion: ["per", "cha"], religion: ["rel", "int"], "sleight of hand": ["slt", "dex"],
  stealth: ["ste", "dex"], survival: ["sur", "wis"],
};
const LANGUAGES = {
  common: "common", draconic: "draconic", dwarvish: "dwarvish", elvish: "elvish", giant: "giant", gnomish: "gnomish",
  goblin: "goblin", halfling: "halfling", orc: "orc", abyssal: "abyssal", celestial: "celestial", "deep speech": "deep",
  infernal: "infernal", sylvan: "sylvan", undercommon: "undercommon", druidic: "druidic", gnoll: "gnoll", aarakocra: "aarakocra",
};
const CR_XP = { 0: 10, 0.125: 25, 0.25: 50, 0.5: 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900, 8: 3900, 9: 5000, 10: 5900, 11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000, 16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000, 21: 33000, 22: 41000, 23: 50000, 24: 62000, 25: 75000, 26: 90000, 27: 105000, 28: 120000, 29: 135000, 30: 155000 };
const SECTION_RE = /^(Traits|Actions|Bonus Actions|Reactions|Legendary Actions|Lair Actions|Mythic Actions)\s*$/i;
const SECTION_ACTIVATION = { traits: null, actions: "action", "bonus actions": "bonus", reactions: "reaction", "legendary actions": "legendary", "lair actions": "lair", "mythic actions": "mythic" };

const num = s => Number(String(s).replace(/[−–—]/g, "-").replace(/,/g, "").replace(/^\+/, ""));
const mod = score => Math.floor((score - 10) / 2);
const cap = s => s.replace(/\b\w/g, c => c.toUpperCase());
const pbForCR = cr => (cr < 5 ? 2 : Math.floor((cr - 1) / 4) + 2);
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Deterministic 16-char Foundry id so [[/item .id]] references stay stable. */
function makeId(seed) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let k = 0; out.length < 16; k++) {
    let h1 = 0xdeadbeef ^ k, h2 = 0x41c6ce57 ^ k;
    for (let i = 0; i < seed.length; i++) {
      const c = seed.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    let n = (h2 >>> 0) * 4294967296 + (h1 >>> 0);
    for (let i = 0; i < 8 && out.length < 16; i++) { out += chars[n % 62]; n = Math.floor(n / 62); }
  }
  return out;
}

// ---------------------------------------------------------------- resolvers
export function nodeResolver(index) {
  return {
    source: "local dnd5e pack index",
    findFeature: name => index[name.toLowerCase()] ?? null,
  };
}

/** Use inside Foundry (v13/v14, dnd5e 5.x/6.x). Call `await foundryResolver()` once, then pass to buildActor. */
export async function foundryResolver() {
  const idx = {};
  for (const key of ["dnd5e.monsterfeatures24", "dnd5e.monsterfeatures"]) {
    const pack = game.packs.get(key);
    if (!pack) continue;
    const index = await pack.getIndex({ fields: ["img", "type"] });
    for (const e of index) {
      const k = e.name.toLowerCase();
      if (!idx[k]) idx[k] = { name: e.name, img: e.img, pack: key, id: e._id, type: e.type };
    }
  }
  return nodeResolver(idx);
}

const COND_WORDS = CONDITIONS.join("|");
/** "the Grappled condition", "the Blinded and Restrained conditions" -> list of conditions in the matched text. */
const CONDRE = new RegExp(`\\bthe\\s+((?:${COND_WORDS})(?:(?:,\\s*(?:and\\s+)?|\\s+and\\s+)(?:${COND_WORDS}))*)\\s+conditions?\\b`, "gi");
function conditionsIn(text) {
  const out = [];
  for (const m of text.matchAll(CONDRE))
    for (const w of m[1].toLowerCase().split(/,\s*(?:and\s+)?|\s+and\s+/)) if (CONDITIONS.includes(w.trim()) && !out.includes(w.trim())) out.push(w.trim());
  return out;
}

const SMALL_WORDS = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);
/** "Keen Hearing and Smell", "Icy Breath (Recharge 5–6)" -> true; "Bludgeoning damage" -> false. */
function isEntryName(name) {
  const words = name.replace(/\s*\([^)]*\)\s*$/, "").split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w, i) => /^[A-Z0-9]/.test(w) || (i > 0 && SMALL_WORDS.has(w)));
}

// ---------------------------------------------------------------- parsing
export function parseStatblock(raw) {
  const warnings = [];
  const text = raw.replace(/\r/g, "").replace(/[−–]/g, m => m); // keep dashes, normalise later per-field
  const lines = text.split("\n").map(l => l.replace(/\s+$/, ""));
  // Re-join wrapped property lines (e.g. a long "Condition Immunities" list that continues on an indented line).
  {
    const LABEL = /^\s*(Armor Class|AC|Hit Points|HP|Speed|Initiative|Saving Throws?|Skills|Damage (Vulnerabilities|Resistances|Immunities)|Condition Immunities|Senses|Languages|Challenge|CR|Proficiency Bonus|Gear)\b/i;
    let cur = -1;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim()) { cur = -1; continue; }
      if (LABEL.test(l)) { cur = /^\s*(Challenge|CR|Proficiency Bonus)\b/i.test(l) ? -1 : i; continue; }
      if (cur >= 0 && !/\bSTR\b.*\bDEX\b/i.test(l) && !/^\s*\d{1,2}\s*\(/.test(l) && !SECTION_RE.test(l.trim())) {
        lines[cur] += " " + l.trim();
        lines[i] = "";
        continue;
      }
      cur = -1;
    }
  }
  const first = lines.findIndex(l => l.trim());
  const sb = { warnings, name: lines[first].trim(), sections: [] };

  // --- size / type / alignment
  const typeLine = lines.slice(first + 1).find(l => l.trim()).trim();
  const tm = typeLine.match(/^(Tiny|Small|Medium|Large|Huge|Gargantuan)(?:\s+or\s+\w+)?\s+([A-Za-z]+)(?:\s*\(([^)]*)\))?,\s*(.+)$/i);
  if (!tm) warnings.push(`Could not parse size/type line: "${typeLine}"`);
  else {
    sb.size = SIZES[tm[1].toLowerCase()];
    sb.type = tm[2].toLowerCase();
    sb.subtype = tm[3] ?? "";
    sb.alignment = cap(tm[4].trim());
    if (!CREATURE_TYPES.includes(sb.type)) warnings.push(`Unknown creature type "${sb.type}"`);
  }

  const body = lines.join("\n");
  const grab = (re, group = 1) => { const m = body.match(re); return m ? m[group].trim() : null; };

  // --- AC / HP / speed / initiative
  const ac = body.match(/^\s*(?:Armor Class|AC)\s+(\d+)(?:\s*\(([^)]*)\))?/im);
  if (ac) sb.ac = { value: Number(ac[1]), note: ac[2] ?? "" };
  else warnings.push("No Armor Class found");
  const hp = body.match(/^\s*(?:Hit Points|HP)\s+(\d[\d,]*)(?:\s*\(([^)]*)\))?/im);
  if (hp) sb.hp = { value: num(hp[1]), formula: (hp[2] ?? "").replace(/\s*([+-])\s*/g, " $1 ").replace(/\s+/g, " ").trim() };
  else warnings.push("No Hit Points found");
  const speed = grab(/^\s*Speed\s+(.+)$/im);
  sb.speed = {};
  if (speed) {
    for (const part of speed.split(/[,;]/)) {
      const m = part.trim().match(/^(?:(walk|burrow|climb|fly|swim)\s+)?(\d+)\s*ft\.?(?:\s*\((hover)\))?/i);
      if (m) { sb.speed[(m[1] ?? "walk").toLowerCase()] = Number(m[2]); if (m[3]) sb.speed.hover = true; }
      else if (part.trim()) warnings.push(`Unparsed speed fragment "${part.trim()}"`);
    }
  }
  const init = body.match(/^\s*Initiative\s+([+\-−–]?\d+)/im);
  if (init) sb.initiative = num(init[1]);

  // --- ability scores (classic "STR DEX .." header + "20 (+5)" row, or "Str 20 +5 +5" table)
  sb.abilities = {};
  const hdr = lines.findIndex(l => /\bSTR\b.*\bDEX\b.*\bCON\b/i.test(l));
  if (hdr >= 0) {
    const chunk = lines.slice(hdr, hdr + 8).join(" ");
    const vals = [...chunk.matchAll(/(\d{1,2})\s*\(\s*([+\-−–]?\s*\d+)\s*\)/g)];
    if (vals.length >= 6) ABILITIES.forEach((a, i) => {
      const raw = vals[i][2].replace(/\s/g, "");
      // a missing sign (OCR dropped the minus) means the stated modifier is unknown, not wrong
      sb.abilities[a] = { value: Number(vals[i][1]), stated: /^[+\-−–]/.test(raw) ? num(raw) : null };
    });
  }
  if (Object.keys(sb.abilities).length < 6) {
    for (const a of ABILITIES) {
      const m = body.match(new RegExp(`\\b${a}\\b\\s+(\\d{1,2})\\s+([+\\-−–]\\d+)`, "i"));
      if (m) sb.abilities[a] = { value: Number(m[1]), stated: num(m[2]) };
    }
  }
  if (Object.keys(sb.abilities).length < 6) warnings.push("Could not read all six ability scores");

  // --- proficiencies & defenses
  sb.skills = {};
  const skillsLine = grab(/^\s*Skills\s+(.+)$/im);
  if (skillsLine) for (const part of skillsLine.split(/,\s*/)) {
    const m = part.trim().match(/^([A-Za-z ]+?)\s+([+\-−–]\d+)$/);
    if (m && SKILLS[m[1].toLowerCase()]) sb.skills[SKILLS[m[1].toLowerCase()][0]] = num(m[2]);
    else warnings.push(`Unparsed skill "${part}"`);
  }
  sb.saves = {};
  const savesLine = grab(/^\s*Saving Throws?\s+(.+)$/im);
  if (savesLine) for (const part of savesLine.split(/,\s*/)) {
    const m = part.trim().match(/^([A-Za-z]+)\s+([+\-−–]\d+)$/);
    const key = m && (ABILITIES.includes(m[1].toLowerCase()) ? m[1].toLowerCase() : ABILITY_NAMES[m[1].toLowerCase()]);
    if (key) sb.saves[key] = num(m[2]); else warnings.push(`Unparsed save "${part}"`);
  }
  sb.dv = grab(/^\s*Damage Vulnerabilities\s+(.+)$/im);
  sb.dr = grab(/^\s*Damage Resistances\s+(.+)$/im);
  sb.di = grab(/^\s*Damage Immunities\s+(.+)$/im);
  sb.ci = grab(/^\s*Condition Immunities\s+(.+)$/im);

  // --- senses / languages / CR
  const senses = grab(/^\s*Senses\s+(.+)$/im);
  sb.senses = { ranges: {}, special: [], passive: null };
  if (senses) for (const part of senses.split(/,\s*/)) {
    let m;
    if ((m = part.match(/^(darkvision|blindsight|tremorsense|truesight)\s+(\d+)\s*ft/i))) sb.senses.ranges[m[1].toLowerCase()] = Number(m[2]);
    else if ((m = part.match(/passive Perception\s+(\d+)/i))) sb.senses.passive = Number(m[1]);
    else if (part.trim()) sb.senses.special.push(part.trim());
  }
  const langs = grab(/^\s*Languages\s+(.+)$/im);
  sb.languages = !langs || /^[—–-]+$/.test(langs) ? [] : langs.split(/[,;]\s*/).map(s => s.trim()).filter(Boolean);
  const chal = body.match(/^\s*(?:Challenge|CR)\s+([\d/]+)(?:\s*\(([^)]*)\))?/im);
  if (chal) {
    sb.cr = chal[1].includes("/") ? chal[1].split("/").reduce((a, b) => a / b) : Number(chal[1]);
    const xp = chal[2]?.match(/(?:XP\s*)?([\d,]+)\s*(?:XP)?/i);
    sb.xp = xp ? num(xp[1]) : null;
    const pb = chal[2]?.match(/PB\s*\+?(\d+)/i);
    sb.statedPB = pb ? Number(pb[1]) : null;
  } else warnings.push("No Challenge rating found");
  const pbLine = grab(/^\s*Proficiency Bonus\s+\+?(\d+)/im);
  if (pbLine) sb.statedPB = Number(pbLine);

  // --- body: traits + action sections
  const crIdx = lines.findIndex(l => /^\s*(?:Challenge|CR)\s+[\d/]/i.test(l));
  const bodyLines = lines.slice((Math.max(crIdx, lines.findIndex(l => /^\s*Proficiency Bonus/i.test(l))) + 1) || 0);
  const hasBlank = bodyLines.join("\n").trim().split(/\n\s*\n/).length > 1;
  let section = "traits", cur = null;
  const entryStart = /^([A-Z][A-Za-z0-9'’ \-\/,]{1,58}?(?:\s*\([^)]{1,40}\))?)\.\s+(\S.*)$/;
  let prevBlank = true, prevText = "";
  for (const line of bodyLines) {
    const t = line.trim();
    if (!t) { prevBlank = true; continue; }
    const sm = t.match(SECTION_RE);
    if (sm) { section = sm[1].toLowerCase(); cur = null; prevBlank = true; prevText = ""; continue; }
    // Without blank lines (OCR / compact paste) an entry may only start after a finished sentence, and its name must be Title Case.
    const startsHere = hasBlank ? prevBlank : (cur == null || cur.name === "" || /[.!?)]$/.test(prevText));
    const em = startsHere ? t.match(entryStart) : null;
    if (em && isEntryName(em[1]) && !/^(Melee|Ranged|Hit|Failure|Success)\b/.test(em[1])) {
      cur = { section, name: em[1].trim(), text: em[2].trim() };
      sb.sections.push(cur);
    } else if (cur) cur.text += (prevBlank ? "\n" : " ") + t;
    else sb.sections.push((cur = { section, name: "", text: t })); // intro text (e.g. legendary action uses)
    prevBlank = false;
    prevText = t;
  }
  for (const e of sb.sections) if (!e.name) {
    const lu = e.text.match(/Legendary Action Uses:\s*(\d+)/i);
    if (lu) sb.legendaryUses = Number(lu[1]);
  }
  sb.sections = sb.sections.filter(e => e.name);
  return sb;
}

// ---------------------------------------------------------------- text helpers
function enrichText(plain, ctx, { keepName = null } = {}) {
  let t = esc(plain);
  // rules references (single pass so nothing is double-wrapped)
  const condRe = new RegExp(`\\b(${CONDITIONS.map(cap).join("|")}|Advantage|Disadvantage)\\b`, "g");
  t = t.replace(condRe, (m, w, off, str) => {
    if (keepName && w.toLowerCase() === keepName.toLowerCase()) return m;
    // only the standalone words, not e.g. "Advantage" inside another name
    return `&amp;Reference[${w}${/^(dis)?advantage$/i.test(w) ? "" : " apply=false"}]`;
  });
  // creature name -> lookup
  if (ctx.name) {
    const nameRe = new RegExp(`\\b(the\\s+)?${ctx.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    t = t.replace(nameRe, (m, the) => the ? `${the}[[lookup @name lowercase]]{monster}` : "[[lookup @name]]{monster}");
  }
  return t;
}

function parseDamageTerms(s) {
  const terms = [];
  for (const m of s.matchAll(/(\d+)\s*\((\d+)d(\d+)(?:\s*([+\-−–])\s*(\d+))?\)\s*([A-Za-z]+)\s+damage/gi)) {
    const type = m[6].toLowerCase();
    terms.push({
      avg: Number(m[1]), number: Number(m[2]), die: Number(m[3]),
      bonus: m[4] ? (/[-−–]/.test(m[4]) ? -1 : 1) * Number(m[5]) : 0,
      type, idx: m.index, end: m.index + m[0].length, validType: DAMAGE_TYPES.includes(type),
    });
  }
  return terms;
}

function conditionEffect(conds, originName) {
  const list = [].concat(conds);
  const name = list.length > 1 ? list.slice(0, -1).map(cap).join(", ") + " and " + cap(list.at(-1)) : cap(list[0]);
  return {
    _id: makeId(`effect:${originName}:${list.join("+")}`),
    name,
    img: `systems/dnd5e/icons/svg/statuses/${list.at(-1)}.svg`,
    type: "base", disabled: false, transfer: false, statuses: list, showIcon: 2, tint: "#ffffff",
    description: list.includes("grappled") ? "<p><strong>Escape Tests (see origin item for DC)</strong></p><p>[[/check skill=ath ability=str]]</p><p>[[/check skill=acr ability=dex]]</p>" : "",
    duration: { value: null, units: "seconds", expiry: null, expired: false },
    origin: null, flags: {}, system: { changes: [] }, start: null, sort: 0,
  };
}

const baseActivity = (type, id, activation) => ({
  _id: id, type, name: "", img: "", sort: 0,
  activation: { type: activation, value: null, override: false, condition: "" },
  consumption: { scaling: { allowed: false }, spellSlot: true, targets: [] },
  description: { chatFlavor: "" },
  duration: { units: "inst", concentration: false, override: false },
  effects: [],
  range: { override: false, units: "self", special: "" },
  target: { template: { contiguous: false, units: "ft", type: "" }, affects: { choice: false, count: "", type: "", special: "" }, override: false, prompt: true },
  uses: { spent: 0, recovery: [], max: "" },
  visibility: { level: {}, requireAttunement: false, requireIdentification: false, requireMagic: false },
});

// ---------------------------------------------------------------- actor building
export function buildActor(sb, { resolver = null } = {}) {
  const warnings = [...sb.warnings];
  const report = { compendium: [], derived: [], checks: [] };
  const abil = Object.fromEntries(ABILITIES.map(a => [a, sb.abilities[a]?.value ?? 10]));
  const mods = Object.fromEntries(ABILITIES.map(a => [a, mod(abil[a])]));
  const cr = sb.cr ?? 0;
  const pb = pbForCR(cr);
  const ctx = { name: sb.name };

  // ---- consistency checks against the statblock itself
  for (const a of ABILITIES) if (sb.abilities[a] && sb.abilities[a].stated != null && sb.abilities[a].stated !== mods[a])
    warnings.push(`${a.toUpperCase()} ${abil[a]} implies ${mods[a]}, statblock says ${sb.abilities[a].stated}`);
  if (sb.xp != null && CR_XP[cr] != null && CR_XP[cr] !== sb.xp) warnings.push(`CR ${cr} should be ${CR_XP[cr]} XP, statblock says ${sb.xp}`);
  if (sb.statedPB != null && sb.statedPB !== pb) warnings.push(`PB for CR ${cr} is +${pb}, statblock says +${sb.statedPB}`);
  const hpm = sb.hp?.formula.match(/^(\d+)d(\d+)(?:\s*([+-])\s*(\d+))?$/);
  if (hpm) {
    const n = Number(hpm[1]), d = Number(hpm[2]), b = hpm[3] ? (hpm[3] === "-" ? -1 : 1) * Number(hpm[4]) : 0;
    const avg = Math.floor(n * (d + 1) / 2 + b);
    report.checks.push(`HP formula ${sb.hp.formula} averages ${avg} (statblock ${sb.hp.value}); CON bonus ${b} vs ${n}×CON mod ${mods.con} = ${n * mods.con}`);
    if (avg !== sb.hp.value) warnings.push(`HP formula averages ${avg}, statblock says ${sb.hp.value}`);
    if (b !== n * mods.con) warnings.push(`HP formula bonus ${b} != ${n} × CON mod (${mods.con})`);
  }
  const prcBonus = sb.skills.prc != null ? sb.skills.prc : mods.wis;
  if (sb.senses.passive != null && sb.senses.passive !== 10 + prcBonus) warnings.push(`Passive Perception ${sb.senses.passive} != 10 + ${prcBonus}`);

  // ---- abilities, saves, skills
  const abilities = {};
  for (const a of ABILITIES) {
    abilities[a] = { value: abil[a], proficient: 0, max: null, bonuses: { check: "", save: "" } };
    if (sb.saves[a] != null) {
      const delta = sb.saves[a] - mods[a];
      if (delta === pb) abilities[a].proficient = 1;
      else if (delta === 0) { /* not actually proficient */ }
      else { abilities[a].proficient = 1; abilities[a].bonuses.save = String(delta - pb); warnings.push(`${a.toUpperCase()} save ${sb.saves[a]} is not mod+PB; added ${delta - pb} save bonus`); }
    }
  }
  const skills = {};
  for (const [name, [key, ability]] of Object.entries(SKILLS)) {
    if (sb.skills[key] == null) continue;
    const delta = sb.skills[key] - mods[ability];
    let value = delta === 2 * pb ? 2 : delta === pb ? 1 : delta === Math.floor(pb / 2) && delta !== 0 ? 0.5 : 0;
    skills[key] = { value, ability };
    if (value === 0 && delta !== 0) { skills[key].value = 1; skills[key].bonuses = { check: String(delta - pb), passive: "" }; warnings.push(`${name} ${sb.skills[key]} is not mod+PB/2PB; added ${delta - pb} bonus`); }
  }

  // ---- traits (defenses)
  const traits = { size: sb.size, di: { value: [], bypasses: [], custom: "" }, dr: { value: [], bypasses: [], custom: "" }, dv: { value: [], bypasses: [], custom: "" }, ci: { value: [], custom: "" }, languages: { value: [], custom: "" } };
  for (const key of ["di", "dr", "dv"]) {
    if (!sb[key]) continue;
    const custom = [];
    for (const seg of sb[key].split(/;\s*/)) {
      const lower = seg.toLowerCase();
      const found = DAMAGE_TYPES.filter(t => new RegExp(`\\b${t}\\b`).test(lower));
      const onlyTypes = lower.replace(/[,]|\band\b|\bor\b/g, " ").split(/\s+/).filter(Boolean).every(w => DAMAGE_TYPES.includes(w));
      if (onlyTypes) traits[key].value.push(...found);
      else if (found.length && /nonmagical/.test(lower)) {
        traits[key].value.push(...found);
        traits[key].bypasses.push("mgc");
        if (/silvered/.test(lower)) traits[key].bypasses.push("sil");
        if (/adamantine/.test(lower)) traits[key].bypasses.push("ada");
      } else custom.push(seg.trim());
    }
    traits[key].custom = custom.join("; ");
  }
  if (sb.ci) for (const c of sb.ci.split(/,\s*|;\s*|\s+and\s+/).map(s => s.trim().toLowerCase()).filter(Boolean)) {
    if (CONDITIONS.includes(c)) traits.ci.value.push(c); else traits.ci.custom += (traits.ci.custom ? "; " : "") + c;
  }
  const langCustom = [];
  const tele = { value: null, units: "ft" };
  for (const l of sb.languages) {
    const lk = LANGUAGES[l.toLowerCase()];
    let m;
    if (lk) traits.languages.value.push(lk);
    else if ((m = l.match(/telepathy\s+(\d+)\s*ft/i))) tele.value = Number(m[1]);
    else langCustom.push(l);
  }
  traits.languages.custom = langCustom.join("; ");
  traits.languages.communication = tele.value ? { telepathy: tele } : {};

  // ---- items
  const items = [];
  const entryIds = new Map(sb.sections.map(e => [e.name.replace(/\s*\(.*\)\s*$/, ""), makeId(`item:${sb.name}:${e.name}`)]));
  let sort = 0;
  const useCompendium = (name, type) => {
    const hit = resolver?.findFeature(name);
    if (hit) { report.compendium.push(`${name} → ${hit.pack}.${hit.id}${hit.img ? " (icon)" : ""}`); return hit; }
    return null;
  };
  const heuristicIcon = (name, fallback) => {
    const n = name.toLowerCase();
    if (/tongue/.test(n)) return "icons/creatures/abilities/mouth-teeth-tongue-purple.webp";
    if (/uproot|quake|tremor|erupt|ground/.test(n)) return "icons/creatures/tentacles/tentacle-earth-green.webp";
    if (/eye|weak point|gaze/.test(n)) return "icons/commodities/biological/eye-red-pink.webp";
    return fallback;
  };

  for (const e of sb.sections) {
    const baseName = e.name.replace(/\s*\(.*\)\s*$/, "");
    const id = entryIds.get(baseName);
    const activation = SECTION_ACTIVATION[e.section];
    const text = e.text.replace(/\s+/g, " ").trim();
    const hit = useCompendium(baseName);
    const item = {
      _id: id, name: baseName, type: "feat", img: hit?.img ?? heuristicIcon(baseName, "icons/svg/aura.svg"),
      effects: [], flags: {}, sort: (sort += 100000), ownership: { default: 0 },
      system: {
        type: { value: "monster", subtype: "" }, activities: {}, uses: { spent: 0, recovery: [], max: "" },
        description: { value: "", chat: "" }, identifier: baseName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        source: { revision: 1, rules: "2024", book: "", custom: "" }, properties: e.section === "traits" ? ["trait"] : [], requirements: "", advancement: {}, enchant: {},
      },
    };
    // uses from the heading: "(3/Day)", "(Recharge 5-6)"
    const head = e.name.match(/\(([^)]*)\)\s*$/)?.[1] ?? "";
    let m;
    if ((m = head.match(/(\d+)\s*\/\s*Day/i))) { item.system.uses.max = m[1]; item.system.uses.recovery = [{ period: "day", type: "recoverAll", formula: "" }]; }
    else if ((m = head.match(/Recharge\s+(\d)(?:\s*[–\-−]\s*\d)?/i))) { item.system.uses.max = "1"; item.system.uses.recovery = [{ period: "recharge", formula: m[1] }]; }
    else if (/Recharges after a (Short|Long) or (Short|Long) Rest/i.test(head)) { item.system.uses.max = "1"; item.system.uses.recovery = [{ period: "sr", type: "recoverAll" }, { period: "lr", type: "recoverAll" }]; }

    const atk = text.match(/^((?:Melee|Ranged)(?: or (?:Melee|Ranged))?)\s+(Attack Roll|Weapon Attack|Spell Attack|Attack):\s*([+\-−–]\d+)\s*(?:\(([^)]*)\))?,?\s*(?:to hit,?\s*)?(.*)$/i);
    const sv = text.match(/^(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) Saving Throw:\s*DC\s*(\d+),?\s*(.*)$/i);

    if (atk) {
      buildAttack(item, e, text, atk, { mods, pb, abil, activation, ctx, warnings, report, sb });
      if (!hit) item.img = heuristicIcon(baseName, resolver?.findFeature("Bite")?.img ?? item.img);
    } else if (sv) {
      buildSave(item, e, text, sv, { activation, ctx, warnings, report, sb });
    } else if (/^Multiattack$/i.test(baseName)) {
      let t = esc(text);
      const names = [...entryIds.keys()].filter(n => !/^Multiattack$/i.test(n)).sort((a, b) => b.length - a.length);
      for (const n of names) t = t.replace(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), `[[/item .${entryIds.get(n)}]]`);
      t = t.replace(new RegExp(`\\b(the\\s+)?${sb.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), (mm, the) => the ? `${the}[[lookup @name lowercase]]{monster}` : "[[lookup @name]]{monster}");
      item.system.description.value = `<p>${t}</p>`;
      const aid = makeId(`act:${baseName}`);
      const act = baseActivity("utility", aid, activation ?? "action");
      act.name = "Use"; act.roll = { prompt: false, visible: false };
      item.system.activities[aid] = act;
      item.system.properties = [];
    } else {
      const paras = text.split("\n").map(p => `<p>${enrichText(p, ctx)}</p>`).join("");
      item.system.description.value = paras;
    }
    if (activation && !item.system.properties.includes("trait")) { /* actions keep activation on their activities */ }
    if (activation === "legendary") { const c = head.match(/Costs (\d+) Actions/i); for (const a of Object.values(item.system.activities)) { a.activation.type = "legendary"; if (c) a.activation.value = Number(c[1]); } }
    items.push(item);
  }

  // ---- actor shell
  const hpVal = sb.hp?.value ?? 1;
  const dim = TOKEN_DIM[sb.size] ?? 1;
  const walkOnly = sb.speed;
  const actor = {
    name: sb.name, type: "npc", img: "icons/svg/mystery-man.svg",
    system: {
      identifier: sb.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      abilities, skills,
      attributes: {
        movement: { burrow: walkOnly.burrow != null ? String(walkOnly.burrow) : null, climb: walkOnly.climb != null ? String(walkOnly.climb) : null, fly: walkOnly.fly != null ? String(walkOnly.fly) : null, swim: walkOnly.swim != null ? String(walkOnly.swim) : null, walk: String(walkOnly.walk ?? 0), units: null, hover: !!walkOnly.hover, ignoredDifficultTerrain: [] },
        senses: { units: null, special: sb.senses.special.join("; "), ranges: { darkvision: sb.senses.ranges.darkvision ?? null, blindsight: sb.senses.ranges.blindsight ?? null, tremorsense: sb.senses.ranges.tremorsense ?? null, truesight: sb.senses.ranges.truesight ?? null } },
        ac: { flat: sb.ac?.value ?? null, calc: /natural/i.test(sb.ac?.note ?? "") || !sb.ac?.note ? (sb.ac?.note ? "natural" : "flat") : "flat" },
        hp: { value: hpVal, max: hpVal, temp: null, tempmax: null, formula: sb.hp?.formula ?? "" },
        init: { ability: "", bonus: sb.initiative != null && sb.initiative !== mods.dex ? String(sb.initiative - mods.dex) : "" },
        spellcasting: "int",
      },
      details: {
        biography: { value: "", public: "" },
        alignment: sb.alignment ?? "", type: { value: sb.type, subtype: sb.subtype ?? "", custom: "", swarm: "" }, cr,
      },
      resources: { legact: { max: sb.legendaryUses ?? 0, spent: 0 }, legres: { max: legRes(sb), spent: 0 }, lair: { value: false, initiative: null, inside: false } },
      source: { revision: 1, rules: "2024", book: "", custom: "" },
      traits,
    },
    prototypeToken: {
      name: sb.name, displayName: 20, actorLink: false, appendNumber: false, prependAdjective: false,
      width: dim, height: dim, disposition: -1, displayBars: 20, bar1: { attribute: "attributes.hp" }, bar2: { attribute: null },
      texture: { src: null, anchorX: 0.5, anchorY: 0.5, fit: "contain", scaleX: 1, scaleY: 1 }, sight: { enabled: false },
    },
    items, effects: [], flags: {},
  };
  report.derived.push(`PB +${pb} (CR ${cr})`, ...ABILITIES.map(a => `${a.toUpperCase()} mod ${mods[a] >= 0 ? "+" : ""}${mods[a]}`));
  report.source = resolver?.source ?? "no compendium";
  return { actor, warnings, report };
}

function legRes(sb) {
  const e = sb.sections.find(s => /^Legendary Resistance/i.test(s.name));
  return e ? Number(e.name.match(/(\d+)\s*\/\s*Day/i)?.[1] ?? 0) : 0;
}

// ---------------------------------------------------------------- attacks
function buildAttack(item, e, text, atk, { mods, pb, activation, ctx, warnings, report }) {
  const [, kind, , bonusRaw, note, rest] = atk;
  const ranged = /^ranged$/i.test(kind.trim());
  const stated = num(bonusRaw);
  const spell = /Spell/i.test(atk[2]);
  const hitIdx = rest.search(/\bHit:/i);
  const geometry = hitIdx >= 0 ? rest.slice(0, hitIdx) : rest;
  const hitText = hitIdx >= 0 ? rest.slice(hitIdx).replace(/^Hit:\s*/i, "") : "";
  const reach = geometry.match(/reach\s+(\d+)\s*ft/i);
  const range = geometry.match(/range\s+(\d+)(?:\s*\/\s*(\d+))?\s*ft/i);
  // Only the first damage sentence is the hit damage; later sentences are riders (e.g. recurring damage while grappled).
  let primary = hitText, restText = "";
  const firstTerm = parseDamageTerms(hitText)[0];
  if (firstTerm) {
    const m = hitText.slice(firstTerm.end).match(/\.(\s+|$)/);
    if (m) { primary = hitText.slice(0, firstTerm.end + m.index + 1); restText = hitText.slice(firstTerm.end + m.index + m[0].length).trim(); }
  }
  // "…, or 6 (1d4 + 4) Piercing damage if the swarm is Bloodied" is an alternative, not extra damage.
  let alt = null;
  const altRe = /,?\s*or\s+(\d+)\s*\((\d+)d(\d+)(?:\s*([+\-−–])\s*(\d+))?\)\s*([A-Za-z]+)\s+damage\s+if\s+(.+?)\s+is\s+Bloodied/i;
  const am = primary.match(altRe);
  if (am) {
    alt = { avg: Number(am[1]), number: Number(am[2]), die: Number(am[3]), bonus: am[4] ? (/[-−–]/.test(am[4]) ? -1 : 1) * Number(am[5]) : 0, typeRaw: am[6], type: am[6].toLowerCase(), who: am[7] };
    primary = primary.replace(altRe, "");
  }
  const terms = parseDamageTerms(primary);
  if (!terms.length) warnings.push(`${e.name}: no damage found`);
  for (const t of terms) if (!t.validType) warnings.push(`${e.name}: unknown damage type "${t.type}"`);

  // which ability explains the to-hit?
  const order = ranged ? ["dex", "str"] : ["str", "dex"];
  const abilityKey = order.find(a => stated === mods[a] + pb);
  const activityId = makeId(`act:${e.name}`);
  const act = baseActivity("attack", activityId, activation ?? "action");
  act.attack = { ability: abilityKey && abilityKey !== order[0] ? abilityKey : "", bonus: "", critical: { threshold: null }, flat: false, type: { value: ranged ? "ranged" : "melee", classification: spell ? "spell" : "weapon" } };
  if (!abilityKey) {
    act.attack.flat = true; act.attack.bonus = String(stated);
    warnings.push(`${e.name}: +${stated} to hit is not mod+PB (+${pb}) for STR/DEX; stored as flat bonus`);
  }
  act.damage = { includeBase: true, critical: { bonus: "" }, parts: [] };
  const baseTerm = terms[0];
  const dmgAbility = abilityKey ?? order[0];
  const baseDelta = baseTerm ? baseTerm.bonus - mods[dmgAbility] : 0;
  if (baseDelta !== 0) warnings.push(`${e.name}: damage bonus ${baseTerm.bonus} != ${dmgAbility.toUpperCase()} mod ${mods[dmgAbility]}; extra "${baseDelta}" stored in damage bonus`);
  const mk = (t, bonus) => ({ number: t.number, denomination: t.die, bonus, types: DAMAGE_TYPES.includes(t.type) ? [t.type] : [], custom: { enabled: false, formula: "" }, scaling: { number: 1 } });
  for (const t of terms.slice(1)) act.damage.parts.push(mk(t, t.bonus ? String(t.bonus) : ""));
  if (reach) act.range = { override: false, units: "self", special: "" };

  item.type = "weapon";
  item.system = {
    ...item.system,
    type: { value: "natural", baseItem: "" },
    properties: [],
    quantity: 1, weight: { value: 0, units: "lb" }, price: { value: 0, denomination: "gp" }, rarity: "", identified: true, equipped: true, attunement: "", attuned: false, proficient: null, mastery: "", ammunition: {}, hp: { value: null, max: null, dt: null, conditions: "" }, container: null,
    range: range ? { value: Number(range[1]), long: range[2] ? Number(range[2]) : null, reach: reach ? Number(reach[1]) : null, units: "ft" } : { value: null, long: null, reach: reach ? Number(reach[1]) : 5, units: "ft" },
    damage: {
      base: baseTerm ? { number: baseTerm.number, denomination: baseTerm.die, types: DAMAGE_TYPES.includes(baseTerm.type) ? [baseTerm.type] : [], custom: { enabled: false, formula: "" }, scaling: { number: 1 }, bonus: baseDelta ? String(baseDelta) : "" } : { number: null, denomination: null, types: [], custom: { enabled: false }, scaling: { number: 1 }, bonus: "" },
      versatile: { number: null, denomination: null, types: [], custom: { enabled: false }, scaling: { number: 1 } },
    },
    uses: item.system.uses,
  };
  delete item.system.requirements; delete item.system.advancement; delete item.system.enchant;
  item.system.activities[activityId] = act;

  // ---- riders: "has the Grappled condition (escape DC 16)", "the Blinded and Restrained conditions"
  const inline = primary.slice(terms.length ? terms[terms.length - 1].end : 0).trim();      // rest of the damage sentence
  const riderAll = `${inline} ${restText}`.trim();
  const conds = conditionsIn(riderAll);
  if (conds.length) {
    const eff = conditionEffect(conds, e.name);
    item.effects.push(eff);
    act.effects.push({ _id: eff._id, level: {} });
    const esc_ = conds.includes("grappled") && riderAll.match(/escape DC\s*(\d+)/i);
    if (esc_) {
      const cid = makeId(`act:${e.name}:escape`);
      const chk = baseActivity("check", cid, "special");
      chk.name = "Escape Check";
      chk.check = { associated: ["acr", "ath"], ability: "", dc: { calculation: "", formula: esc_[1] } };
      item.system.activities[cid] = chk;
      report.derived.push(`${e.name}: escape DC ${esc_[1]} → Escape Check activity (flat DC)`);
    }
  }
  // ---- Bloodied alternative -> second attack activity that replaces the base damage
  let altHtml = "";
  if (alt) {
    const bid = makeId(`act:${e.name}:bloodied`);
    const bact = structuredClone(act);
    bact._id = bid; bact.name = "Bloodied"; bact.sort = 1;
    const altPart = { ...mk({ number: alt.number, die: alt.die, type: alt.type }, alt.bonus === mods[dmgAbility] ? "@mod" : alt.bonus ? String(alt.bonus) : "") };
    bact.damage = { includeBase: false, critical: { bonus: "" }, parts: [altPart, ...act.damage.parts.map(p => structuredClone(p))] };
    item.system.activities[bid] = bact;
    const dice = `${alt.number}d${alt.die}${alt.bonus ? ` ${alt.bonus < 0 ? "-" : "+"} ${Math.abs(alt.bonus)}` : ""}`;
    altHtml = ` If ${esc(alt.who)} is Bloodied, the ${esc(alt.typeRaw)} damage is instead ${alt.avg} (${dice}); use the Bloodied activity.`;
  }
  const noteHtml = note ? ` (${enrichText(note, ctx)})` : "";
  let inlineHtml;
  if (!inline || /^[.]+$/.test(inline)) inlineHtml = ".";
  else if (/^[,;]/.test(inline)) inlineHtml = enrichText(inline, ctx);
  else inlineHtml = " " + enrichText(inline, ctx);
  item.system.description.value = `<p>[[/attack extended]]${noteHtml}. [[/damage average extended]]${inlineHtml}${altHtml}${restText ? " " + enrichText(restText, ctx) : ""}</p>`;
}

// ---------------------------------------------------------------- saves
function buildSave(item, e, text, sv, { activation, ctx, warnings, report }) {
  const abilityKey = ABILITY_NAMES[sv[1].toLowerCase()];
  const dc = Number(sv[2]);
  const afterDC = sv[3];
  const split = afterDC.search(/\b(Failure or Success|Failure|Success):/);
  const targetText = (split >= 0 ? afterDC.slice(0, split) : afterDC).trim().replace(/[.,]$/, "");
  const outcomes = split >= 0 ? afterDC.slice(split) : "";
  const fail = outcomes.match(/Failure:\s*(.*?)(?=\s*(?:Success|Failure or Success):|$)/s)?.[1]?.trim() ?? "";
  const success = outcomes.match(/(?<!or )Success:\s*(.*?)(?=\s*(?:Failure or Success):|$)/s)?.[1]?.trim() ?? "";
  const both = outcomes.match(/Failure or Success:\s*(.*)$/s)?.[1]?.trim() ?? "";

  const id = makeId(`act:${e.name}`);
  const act = baseActivity("save", id, activation ?? "action");
  act.save = { ability: [abilityKey], dc: { calculation: "", formula: String(dc) } };
  const terms = parseDamageTerms(fail);
  for (const t of terms) if (!t.validType) warnings.push(`${e.name}: unknown damage type "${t.type}"`);
  act.damage = {
    onSave: /half damage/i.test(success) ? "half" : "none",
    parts: terms.map(t => ({ number: t.number, denomination: t.die, bonus: t.bonus ? String(t.bonus) : "", types: DAMAGE_TYPES.includes(t.type) ? [t.type] : [], custom: { enabled: false, formula: "" }, scaling: { number: 1 } })),
  };

  // targeting
  const rng = targetText.match(/within\s+(\d+)\s*(?:feet|ft\.?)/i);
  if (rng) act.range = { override: false, units: "ft", value: rng[1], special: "" };
  const area = targetText.match(/(\d+)-foot[- ](Cone|Cube|Sphere|Line|Cylinder|Emanation|Radius)/i);
  if (area) act.target.template = { contiguous: false, units: "ft", type: area[2].toLowerCase() === "radius" ? "radius" : area[2].toLowerCase(), size: area[1], count: "" };
  if (/^one\b/i.test(targetText) || /\bone creature\b/i.test(targetText)) act.target.affects = { choice: false, count: "1", type: "creature", special: "" };
  else if (/each creature/i.test(targetText)) act.target.affects = { choice: false, count: "", type: "creature", special: "" };

  // condition on failed save -> effect
  const failConds = conditionsIn(fail);
  if (failConds.length) {
    const eff = conditionEffect(failConds, e.name);
    item.effects.push(eff);
    act.effects.push({ _id: eff._id, onSave: false });
  }

  // description (mirrors the compendium's own save-feature layout)
  const lookupTarget = enrichText(targetText, ctx)
    .replace(/\bwithin\s+\d+\s*(?:feet|ft\.?)/i, `within [[lookup @range.value activity=${id}]] feet`);
  const failRest = fail.replace(/^.*?damage\.?\s*/s, terms.length ? "" : fail).trim();
  const failHtml = terms.length
    ? `<em>Failure:</em> [[/damage average]] damage.${failRest ? " " + enrichText(failRest, ctx) : ""}`
    : `<em>Failure:</em> ${enrichText(fail, ctx)}`;
  let html = `<p><em>${sv[1]} Saving Throw:</em> DC [[lookup @save.dc.value activity=${id}]], ${lookupTarget}.</p>`;
  if (fail) html += `<p>${failHtml}</p>`;
  if (success) html += `<p><em>Success:</em> ${enrichText(success, ctx)}</p>`;
  if (both) html += `<p><em>Failure or Success:</em> ${enrichText(both, ctx)}</p>`;
  item.system.description.value = html;
  item.system.activities[id] = act;
  item.system.properties = [];
}

// ---------------------------------------------------------------- convenience
export function importStatblock(text, opts = {}) {
  return buildActor(parseStatblock(text), opts);
}
