# Open Concept Designs

A browser game where you design buildings on a blueprint grid, then watch simulated people use them and get scored on flow, looks, budget and how well you met the client's brief.

Play: https://kimblejennings97.github.io/open-concept-designs/ · Design doc: https://claude.ai/artifact/9NqdThHTVip5Ys5XEjPzRw

## Modes

- **Career**: start a rookie firm, take jobs from the offer board (starter home, then the corner store, then more), earn fees and XP, and get promoted by meeting tier objectives. Items above your tier are hidden.
- **Sandbox career**: a separate save. You're a top-tier firm with everything unlocked and a rotating stream of clients. Client budgets still apply.
- **Free build**: **New** in the top bar. Blank lot or a sample (house, store, bistro, nightclub, apartment building), everything unlocked, no client. You can also practice any client brief from there.

## Career ladder

| Tier | Jobs |
| --- | --- |
| 1 Rookie | Starter home, garden cottage, corner store, late-night mini mart |
| 2 Local firm | Family home, corner cafe, neighborhood bistro |
| 3 Regional | Full-size trattoria, warehouse nightclub, neighborhood grocery store |
| 4 Established | Garden apartments, warehouse lofts, estate home |
| 5 Elite | Hillside mansion, luxury residences, supper club |

Each building type has its own simulation: a morning rush (houses and apartments), shoppers (stores), dinner service with diners and servers (restaurants), and a Saturday night of coats, drinks and dancing (nightclubs).

## How a job goes

1. Outline the building (Footprint), wall it in, split it into rooms and add doors and windows.
2. Give each room a type, flooring and wall finish (Room tool).
3. Furnish it from the catalog (Furniture tool). Pieces need clearance in front, shouldn't block door swings, and some must back onto a wall.
4. **Run simulation** to watch residents or shoppers use the building, with a heatmap of where they got stuck.
5. **Submit to client** to get a report card: Flow, Looks, Budget and Brief scores, weighted by the brief, turned into 0 to 3 stars.
6. **3D** shows the building in 3D with people replaying the simulation. Toggle the roof, and tap doors to open them.

## Controls

| Action | Mouse / keyboard | Touch |
| --- | --- | --- |
| Tools: Footprint, Wall, Transition, Door, Window, Room, Furniture, Roof, Erase | `F` `W` `T` `D` `N` `O` `C` `P` `E` | Tool buttons |
| Remove with the current tool | Right-drag, or Shift-drag | **Remove** toggle |
| Rotate furniture / flip a door | `R` | Rotate button / Flip swing |
| Window width | `[` `]` | Width picker |
| Delete selected furniture | `Delete` | Delete button |
| Undo / redo | `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| Pan | Middle-drag, or hold `Space` and drag | Two fingers |
| Zoom | Mouse wheel | Pinch |
| Fit lot to screen / deselect | `Home` / `Esc` | Fit view |
| Meters ↔ feet and square feet | **m²** / **ft²** button in the top bar | Same |

Designs autosave in the browser (IndexedDB). **Export** / **Import** save a design as a `.ocd.json` file.

## Run it locally

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests + a jsdom smoke test of the UI
npm run build    # type-check + production build into dist/
```

## Layout

```
src/
  data/      JSON content: materials, room types, prices, furniture catalog, client briefs, career tiers.
  model/     Pure data + rules: grid, Design, rooms, furniture placement, cost, scoring, samples. No DOM.
  sim/       navgrid, astar, engine: generic crowd sim (no model/UI imports, reusable for the traffic game).
             scenarios: turns a Design into residents/shoppers and scores the flow.
  game/      evaluate (grades a design against its brief), career (offers, fees, XP, tiers).
  editor/    Canvas blueprint editor (rendering, tools, touch gestures, sim playback) and undo history.
  view3d/    Three.js scene builder and viewer (loaded on demand).
  ui/        Brief panel and report card, career office, coach tips, sound effects.
  storage/   IndexedDB (designs, career saves) and localStorage (small preferences).
  main.ts    Page wiring.
```

Grid: one cell is 0.5 m. Walls sit on cell edges. A wall with building on one side is exterior, on both sides interior. Doors and windows span consecutive wall edges, and windows only go on exterior walls. A transition marks an interior edge as an open boundary: the rooms on each side are separate (own type and floor) but people walk straight through, as in an open kitchen and living room. Doors have a style and color; the Roof tool picks gable, hip, shed or flat.

## Deploy

`.github/workflows/deploy.yml` runs the tests, builds and publishes to GitHub Pages on every push to `main`. The Vite `base` is `/open-concept-designs/`. Pages → Source must be set to **GitHub Actions**.

## Notes

- `npm test` goes through `scripts/vitest.mjs`, which fixes a Windows issue where a lowercase drive letter in the working directory (`c:\`) makes every Vitest suite fail with "reading 'config'".
