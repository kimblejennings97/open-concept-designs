# Open Concept Designs

A browser game where you design buildings on a blueprint grid, then watch simulated people use them and get scored on flow, looks, budget and how well you met the client's brief.

Design doc: https://claude.ai/artifact/9NqdThHTVip5Ys5XEjPzRw

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (Vitest)
npm run build    # type-check + production build into dist/
```

## Controls (blueprint editor)

| Action | Input |
| --- | --- |
| Tools: Footprint, Wall, Door, Window, Erase | `F` `W` `D` `N` `E` |
| Remove with the current tool | Right-drag, or Shift-drag |
| Flip door swing | `R` |
| Window width | `[` `]` |
| Undo / redo | `Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`) |
| Pan | Middle-drag, or hold `Space` and drag |
| Zoom | Mouse wheel |
| Fit lot to screen | `Home` |

Designs autosave to the browser (IndexedDB). **New** and **Open…** are in the top bar.

## Layout

```
src/
  model/    Pure data + rules: grid geometry, Design, walls/openings validation, serialization. No DOM.
  editor/   Canvas blueprint editor (rendering, tools, input) and undo/redo history.
  storage/  IndexedDB (designs) and localStorage (small preferences).
  sim/      (milestone 5) Pathfinding and agent simulation, kept free of UI/Three.js imports
            so it can be split into a shared package for the traffic game later.
  main.ts   Page wiring: toolbar, dialogs, autosave, keyboard shortcuts.
```

Grid: one cell is 0.5 m. Walls sit on cell edges; a wall with building footprint on one side is exterior, on both sides is interior. Doors and windows span consecutive wall edges, and windows only go on exterior walls.

## Deploy

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main`. The Vite `base` is `/open-concept-designs/`, so the repo must have that name (or change `REPO_NAME` in `vite.config.ts`). In the repo settings, set **Pages → Source** to **GitHub Actions**.

## Notes

- `npm test` goes through `scripts/vitest.mjs`, which fixes a Windows issue where a lowercase drive letter in the working directory (`c:\`) makes every Vitest suite fail with "reading 'config'".
