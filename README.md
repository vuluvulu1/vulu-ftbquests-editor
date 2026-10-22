<div align="center">

<img src="public/logo.svg" width="112" alt="Vulu FTBQuests Editor logo" />

# Vulu FTBQuests Editor

**A standalone editor for FTB Quests.**<br />
Create and edit your modpack's quest book on the desktop, no Minecraft required.

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
![Minecraft 1.18–1.20.1](https://img.shields.io/badge/Minecraft-1.18%E2%80%931.20.1-62B47A)
![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D6)
![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-FFC131)

</div>

---

Writing quests in game means constant restarts, tiny text boxes and no undo. This editor opens your
modpack's quest files directly and shows them the way the in-game book does: real item icons, the pack's
own textures and translations. You can build whole chapters, then just launch the game.

## Features

- **Familiar editing.** Right-click the map to add a quest, click it to edit. The quest window works like
  the one in FTB Quests, with tasks, rewards, dependencies and description in one place.
- **Real item icons.** Read from vanilla, your mods, KubeJS and resource packs. 3D block models included.
- **JEI-style item search.** Search by name or ID, or filter by mod with `@`, e.g. `@mekanism ingot`.
- **Color without format codes.** Style descriptions with a toolbar; the `&a` / `&l` codes are written for you.
- **Translation support.** Packs that use lang keys (`{ftbquests.chapter...}`) show and edit the actual
  text, saved to the pack's KubeJS lang file.
- **Chapter images.** Move, resize and add decorations, including your own PNGs.
- **Safe saving.** Untouched files stay byte-identical, only changed files are written, and every save
  makes a backup first. Full undo/redo.
- **Advanced mode.** Every quest setting in a side panel, plus raw SNBT editing for anything without a form.

## Getting started

Download `vulu-ftbquests-editor_…_x64.exe` from [Releases](https://github.com/vuluvulu1/vulu-ftbquests-editor/releases/latest)
and run it, no installation needed. The exe isn't code-signed yet, so Windows SmartScreen may warn you;
choose **More info → Run anyway**.

1. **Close Minecraft** (or the server) first. Otherwise FTB Quests may overwrite your changes when it saves.
2. Click **Open modpack** and select the instance folder, the one containing `mods` and `config`
   (e.g. `CurseForge/Instances/MyPack`).
3. Make your changes and press **Ctrl+S**.

On first launch you'll be asked to pick **Simple** (recommended) or **Advanced** mode. You can switch
later from the toolbar.

The interface is available in **English** and **Turkish**; it follows your system language, and you can
switch it from the toolbar at any time.

### Controls

| Action | How |
|---|---|
| Add a quest | Right-click an empty spot on the map |
| Edit a quest | Click it |
| Add a dependency | **+** under *Dependencies* in the quest window, or Ctrl+click quests and right-click the target |
| Add / reorder chapters | Green **+** above the chapter list, or right-click a chapter |
| Undo / Redo / Save | `Ctrl+Z` / `Ctrl+Y` / `Ctrl+S` |

If the game is running while you edit lang files or images, press `F3+T` in game to reload resources.

## Compatibility

| Minecraft | Quest format | Status |
|---|---|---|
| 1.18 – 1.20.1 | SNBT files in `config/ftbquests/quests` | Supported, tested on real modpacks |
| 1.21+ | SNBT + `lang/` translation files | Supported, not yet tested on a real modpack |

Tested with **Tech Revolution** (1.19.2, ~4,400 quests) and **MC Eternal 2** (1.20.1, ~1,500 quests).

## Building from source

Requirements: [Node.js](https://nodejs.org) 20+, [Rust](https://rustup.rs), and WebView2 (preinstalled on Windows 10/11).

```bash
npm install
npm run tauri dev     # run the app
npm run tauri build   # build an installer → src-tauri/target/release/bundle
npm test              # run the test suite
```

<details>
<summary><b>Testing with your own modpacks</b></summary>

Put a modpack instance (or just its `config/ftbquests/quests` folder) into `samples/`. This folder is
git-ignored. `npm test` then checks every pack: all `.snbt` files must round-trip unchanged, the book must
load cleanly, reward tables and translations must resolve, and a single edit must only touch its own file.

With `npm run dev` running, open `http://localhost:1420/?sample=<folder>` to browse a pack read-only.

</details>

<details>
<summary><b>Project layout</b></summary>

| Path | Contents |
|---|---|
| `src/core/snbt/` | SNBT parser and writer that preserve formatting and number types |
| `src/core/book.ts` | Quest book model: loading, saving, undo, translations, images |
| `src/core/assets/` | Mod jar reading, item model → icon and name resolution |
| `src/ui/` | React UI; the quest map uses React Flow |
| `src/platform/` | File access for the desktop app, browser and tests |
| `src-tauri/` | Rust backend: file access with path checks, backups, jar reading |

</details>

## License

Licensed under the [GNU Affero General Public License v3.0](LICENSE).

This project is not affiliated with or endorsed by Feed The Beast. No Minecraft, FTB Quests or mod assets
are included; everything is read from your own modpack. The UI font is
[Pixelify Sans](https://fonts.google.com/specimen/Pixelify+Sans) (SIL Open Font License 1.1, [text](LICENSE-PixelifySans.txt)).
All third-party components and their licenses: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
