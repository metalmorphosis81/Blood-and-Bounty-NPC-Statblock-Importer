# Blood & Bounty NPC Statblock Importer

Turn a 5e monster statblock into a ready-to-use dnd5e NPC actor in Foundry VTT. Paste text, drop in a text file or PDF, or use a screenshot or photo of the statblock.

**Requires:** Foundry VTT v13 or v14 and the dnd5e system 5.0.0 or newer (tested on 6.0.6).

## Install
In Foundry, go to **Add-on Modules → Install Module** and paste this manifest URL:

```
https://github.com/metalmorphosis81/Blood-and-Bounty-NPC-Statblock-Importer/releases/latest/download/module.json
```

Or download the zip from the latest release and unzip `module.zip` into a new folder named `Data/modules/bab-statblock-importer/`. Then enable the module in a dnd5e world.

## Use
1. Open the **Actors** sidebar and click **Import Statblock**.
2. Provide the statblock in any of these ways:
   - paste the text into the box
   - choose a file: `.txt`, `.md`, `.pdf`, or an image (png, jpg, webp and others)
   - drag a file onto the dialog
   - paste a screenshot with Ctrl+V
3. Check the text. Uploaded files are read into the box first so you can fix anything before importing.
4. Click **Import**. The NPC is created in the Actors directory. Any warnings are shown afterwards.

Both the 2024 and the 2014 statblock layouts are supported.

## What you get
- Abilities, saves, skills, AC, HP, speeds, senses, languages, CR, resistances, immunities and vulnerabilities.
- Traits, actions, bonus actions, reactions and legendary actions as items with working activities (attack, save, check, utility).
- Attack riders become real effects: for example "Grappled (escape DC 12)" adds the condition effect plus an Escape Check.
- Multiattack links to the action items it names.
- Bloodied alternatives (such as extra damage when Bloodied) become a separate **Bloodied** attack activity.
- Icons come from the dnd5e monster-feature compendiums (`monsterfeatures24`, then `monsterfeatures`) when a feature name matches.

## Accuracy checks
Numbers are read from the text and cross-checked: ability modifiers, HP formula against average HP, proficiency bonus, XP and passive Perception. Any mismatch is listed in a warnings dialog instead of being silently fixed.

OCR is good but not perfect. Small-caps titles are the hardest part, so glance at the creature's name and the numbers. If a letter in the name is misread, it is corrected from the body text where the name appears there, and the dialog tells you.

## Limitations
- Spellcasting blocks, armor items, and lair or mythic details are not handled yet.
- OCR is English only.
- Very low-resolution scans can still produce misread text. Fix it in the box before importing.

## Settings
PDF and image reading load **pdf.js** and **Tesseract.js** from a CDN the first time you use them. Their URLs, pinned to specific versions, are in the module settings. Pasted text and `.txt` / `.md` files need no internet connection.

To run fully offline, self-host the library files, point the URL settings at them, and use the **Advanced: Tesseract worker options** setting (`workerPath`, `corePath`, `langPath`).

## API / macros
```js
const api = game.modules.get("bab-statblock-importer").api;
api.importText(text);   // create an actor from statblock text
api.importFile(file);   // read a File and create an actor
api.readFile(file);     // read a File and return its text
api.openDialog();       // open the import dialog
```

## Credits and license
Released under the MIT License (see `LICENSE`).

pdf.js and Tesseract.js are Apache-2.0 licensed. They are loaded from a CDN at runtime and are not bundled with this module.

Report problems at [GitHub Issues](https://github.com/metalmorphosis81/Blood-and-Bounty-NPC-Statblock-Importer/issues).
