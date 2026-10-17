# Vulu FTBQuests Editor

Edit your FTB Quests quest book without starting Minecraft.

Point it at your modpack's instance folder and you get the quest map the way it looks in game: real item
icons, the pack's own translations, chapter images, FTB's quest shapes. Add and change quests, hit save,
and they're there next time you launch the game.

> Not affiliated with or endorsed by Feed The Beast. FTB Quests is their mod; this is just a tool that
> reads and writes its files.

It's built around Minecraft **1.18–1.20.1** quest books. Packs using the newer 1.21 `lang/` files should
work too, but I haven't tested one properly yet.

## What it can do

**Two ways to edit.** On first launch it asks which one you want, and you can switch any time from the toolbar.

- *Simple* (the default) works like FTB Quests' own editor. Right-click empty space and pick a task type to
  add a quest, click a quest to open its window and edit the title, description, tasks, rewards and
  dependencies.
- *Advanced* puts every setting in a side panel, including raw SNBT editing for the stuff there's no form for.

**It looks like the real thing.** Item icons and names are read straight from the vanilla jar, your mod jars,
KubeJS and any enabled resource packs. Flat items, blocks and Blockbench-style 3D models are drawn at the
inventory angle. The item picker searches like JEI, so `@mekanism ingot` does what you'd expect.

**Colored text without the codes.** Descriptions get a small rich text editor: pick a color or make
something bold and it writes the `&a` / `&l` codes for you. Text effect tags like `<grad>` or `<rainb>`
are kept intact.

**Translated packs just work.** If the pack writes titles as `{ftbquests.chapter.…}` keys (MC Eternal does),
you see and edit the actual text, and the change goes into the pack's KubeJS lang file.

**Chapter images.** Move and resize the decorations on the quest map, or pick a PNG from your computer. It gets
copied into the pack's KubeJS textures and placed on the chapter.

**Careful with your files.** Files you didn't touch are written back byte for byte, only changed files are saved,
there's undo/redo, and every save makes a backup in `config/ftbquests/editor-backups/` first.

## Using it

The interface is in Turkish for now; the button names below are given in both languages.

1. Close the game (or the server). If it's running, FTB Quests may save over your changes.
2. Click **Open modpack** (*Mod paketi aç*) and pick the instance folder, the one with `mods` and `config` in it
   (for example `CurseForge\Instances\YourPack`).
3. Edit, then save with **Ctrl+S**. If the game is already open and you changed lang files or images, press
   **F3+T** to reload resources.

A few things worth knowing in simple mode:

| To... | Do this |
|---|---|
| Add a quest | Right-click empty space on the map and pick a task type |
| Edit a quest | Click it |
| Add a dependency | Use the "+" next to Dependencies (*Gereksinimler*) in the quest window, or Ctrl+click the required quests and right-click the target |
| Add or reorder chapters | The green **+** above the chapter list, or right-click a chapter |
| Undo / redo / save | Ctrl+Z / Ctrl+Y / Ctrl+S |

## Building it yourself

You'll need Node.js 20+, Rust (for Tauri 2), and WebView2 on Windows.

```bash
npm install
npm run tauri dev     # run the desktop app
npm test              # run the tests
npm run tauri build   # make an installer (ends up in src-tauri/target/release/bundle)
```

`npm run dev` also runs it in Chrome or Edge, using the browser's folder access. That's handy for
development, but the browser can't reach the vanilla Minecraft jar, so `minecraft:` items show up without icons.

### Testing against real packs

Drop a modpack (or just its `config/ftbquests/quests` folder) into `samples/`. It's git-ignored, so nothing
gets committed. `npm test` will then check each pack: every `.snbt` file round-trips unchanged, the book loads
cleanly, reward tables and translations resolve, most item icons are found, and a single edit only touches
the file it should. With `npm run dev` running, `http://localhost:1420/?sample=<folder>` opens a pack
read-only in the browser.

So far it's been tried on Tech Revolution (1.19.2, about 4,400 quests) and MC Eternal 2 (1.20.1, about
1,500 quests and 5,000 translated texts).

### Where things live

- `src/core/snbt/`: the SNBT parser and writer, which keep number types and formatting
- `src/core/book.ts`: the quest book: loading, saving, undo, translations, images, cleaning up references
- `src/core/assets/`: reading mod jars and turning item models into icons and names
- `src/ui/`: the React UI (the map uses React Flow); `src/ui/simple/` holds the simple mode windows and menus
- `src/platform/`: file access for the desktop app, the browser and tests
- `src-tauri/`: the Rust side: file access with path checks, backups, reading ranges out of mod jars

## License

[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-or-later).

No Minecraft, FTB Quests or mod assets are included here. The editor reads them from your own modpack.
The pixel font in the UI is [Pixelify Sans](https://fonts.google.com/specimen/Pixelify+Sans), under the
SIL Open Font License 1.1.
