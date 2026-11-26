import './style.css';
import { type DoorKind, Editor, TOOL_HINTS, type ToolId } from './editor/editor';
import { type Design, OPENING_SPECS, createDesign, deserialize, encloseFootprint, serialize, stats } from './model/design';
import { CELL_M, fmtMeters } from './model/grid';
import { type Room, roomFloor, roomWalls, setRoomFloor, setRoomType, setRoomWalls } from './model/rooms';
import { computeCost, fmtMoney } from './model/cost';
import {
  type BuildingType,
  CATALOG,
  FLOOR_MATERIALS,
  type Material,
  ROOM_TYPES,
  WALL_FINISHES,
  catalogItem,
  roomType,
} from './data/catalog';
import { deleteDesign, listDesigns, loadDesign, saveDesign } from './storage/db';
import { getLastDesignId, setLastDesignId } from './storage/settings';

const IS_TOUCH = matchMedia('(pointer: coarse)').matches;
const TOUCH_HINT = 'Two fingers pan and zoom. Toggle Remove to erase with any tool.';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const TOOLS: Array<{ id: ToolId; label: string; key: string }> = [
  { id: 'footprint', label: 'Footprint', key: 'F' },
  { id: 'wall', label: 'Wall', key: 'W' },
  { id: 'door', label: 'Door', key: 'D' },
  { id: 'window', label: 'Window', key: 'N' },
  { id: 'room', label: 'Room', key: 'O' },
  { id: 'furniture', label: 'Furniture', key: 'C' },
  { id: 'erase', label: 'Erase', key: 'E' },
];

const el = {
  name: $<HTMLInputElement>('design-name'),
  saveState: $('save-state'),
  tools: $('tools'),
  options: $('options'),
  undo: $<HTMLButtonElement>('btn-undo'),
  redo: $<HTMLButtonElement>('btn-redo'),
  stats: $('stats'),
  cost: $('cost'),
  hint: $('status-hint'),
  pos: $('status-pos'),
  dlgNew: $<HTMLDialogElement>('dlg-new'),
  formNew: $<HTMLFormElement>('form-new'),
  dlgOpen: $<HTMLDialogElement>('dlg-open'),
  designList: $('design-list'),
};

// ---------------------------------------------------------------------------
// Autosave
// ---------------------------------------------------------------------------

let saveTimer: number | undefined;
let pendingSave: Promise<void> = Promise.resolve();

function setSaveState(text: string, error = false): void {
  el.saveState.textContent = text;
  el.saveState.classList.toggle('error', error);
}

function scheduleSave(): void {
  setSaveState('Saving…');
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void flushSave(), 400);
}

async function flushSave(): Promise<void> {
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  const data = serialize(editor.design);
  pendingSave = pendingSave
    .then(() => saveDesign(data))
    .then(() => {
      setLastDesignId(data.id);
      setSaveState('All changes saved');
    })
    .catch((err: unknown) => {
      console.error(err);
      setSaveState('Not saved: browser storage is unavailable', true);
    });
  await pendingSave;
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function renderTools(): void {
  el.tools.replaceChildren(
    ...TOOLS.map((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(editor.tool === t.id));
      b.innerHTML = `<span>${t.label}</span><kbd>${t.key}</kbd>`;
      b.onclick = () => editor.setTool(t.id);
      return b;
    }),
  );
}

function renderOptions(): void {
  el.options.replaceChildren();
  if (editor.tool === 'door') {
    const h = document.createElement('h2');
    h.textContent = 'Door';
    const seg = document.createElement('div');
    seg.className = 'segmented';
    for (const kind of ['door', 'double-door'] as DoorKind[]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = kind === 'door' ? 'Single' : 'Double';
      b.setAttribute('aria-pressed', String(editor.doorKind === kind));
      b.onclick = () => {
        editor.doorKind = kind;
        refreshUi();
      };
      seg.append(b);
    }
    const flip = document.createElement('button');
    flip.type = 'button';
    flip.textContent = 'Flip swing (R)';
    flip.style.width = '100%';
    flip.onclick = () => editor.flipDoor();
    el.options.append(h, seg, flip);
  } else if (editor.tool === 'window') {
    const h = document.createElement('h2');
    h.textContent = 'Window';
    const label = document.createElement('label');
    label.textContent = 'Width ( [ and ] )';
    const sel = document.createElement('select');
    const spec = OPENING_SPECS.window;
    for (let len = spec.minLen; len <= spec.maxLen; len++) {
      const o = new Option(fmtMeters(len), String(len), false, len === editor.windowLen);
      sel.append(o);
    }
    sel.onchange = () => {
      editor.windowLen = Number(sel.value);
      refreshUi();
    };
    label.append(sel);
    el.options.append(h, label);
  } else if (editor.tool === 'room') {
    renderRoomPanel();
  } else if (editor.tool === 'furniture') {
    renderFurniturePanel();
  }
}

function h2(text: string): HTMLHeadingElement {
  const h = document.createElement('h2');
  h.textContent = text;
  return h;
}

function note(text: string, cls = 'note'): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = cls;
  p.textContent = text;
  return p;
}

function renderRoomPanel(): void {
  const room = editor.selectedRoom();
  if (!room) {
    const rooms = editor.getRooms().rooms;
    const open = rooms.filter((r) => !r.enclosed).length;
    const unassigned = rooms.filter((r) => r.enclosed && !r.type).length;
    el.options.append(h2('Room'), note('Click a room on the blueprint to select it.'));
    if (rooms.length) {
      el.options.append(
        note(`${rooms.length} area${rooms.length === 1 ? '' : 's'} · ${unassigned} unassigned · ${open} not enclosed`),
      );
    }
    return;
  }

  const type = roomType(room.type);
  el.options.append(h2(type?.name ?? 'Room'), note(`${room.areaM2.toFixed(1)} m²`));
  if (!room.enclosed) el.options.append(note('Not enclosed: add walls to close this area in.', 'note warn'));
  if (type && room.areaM2 < type.minAreaM2) {
    el.options.append(note(`Small for a ${type.name.toLowerCase()} (aim for ${type.minAreaM2} m²+).`, 'note warn'));
  }

  // Type
  const typeLabel = document.createElement('label');
  typeLabel.textContent = 'Type';
  const sel = document.createElement('select');
  sel.append(new Option('Unassigned', '', false, !room.type));
  for (const [group, label] of [
    ['house', 'House'],
    ['store', 'Store'],
  ] as const) {
    const og = document.createElement('optgroup');
    og.label = label;
    for (const t of ROOM_TYPES.filter((t) => t.buildingTypes[0] === group)) {
      og.append(new Option(t.name, t.id, false, t.id === room.type));
    }
    sel.append(og);
  }
  sel.onchange = () => editor.editSelectedRoom((d, r) => setRoomType(d, r, sel.value || null));
  typeLabel.append(sel);
  el.options.append(typeLabel);

  // Floor & walls
  el.options.append(
    swatches('Floor', FLOOR_MATERIALS, roomFloor(editor.design, room), (id) =>
      editor.editSelectedRoom((d, r) => setRoomFloor(d, r, id)),
    ),
  );
  if (room.wallSides.length) {
    el.options.append(
      swatches('Walls', WALL_FINISHES, roomWalls(editor.design, room), (id) =>
        editor.editSelectedRoom((d, r) => setRoomWalls(d, r, id)),
      ),
    );
  }
}

function swatches(
  title: string,
  materials: readonly Material[],
  current: string | null | 'mixed',
  pick: (id: string | null) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'swatch-group';
  const label = document.createElement('div');
  label.className = 'swatch-title';
  label.textContent = current === 'mixed' ? `${title} (mixed)` : title;
  const list = document.createElement('div');
  list.className = 'swatches';
  const button = (id: string | null, name: string, color: string | null, price: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(current === id));
    const chip = document.createElement('span');
    chip.className = 'chip';
    if (color) chip.style.background = color;
    else chip.classList.add('none');
    const n = document.createElement('span');
    n.className = 'name';
    n.textContent = name;
    const p = document.createElement('span');
    p.className = 'price';
    p.textContent = price;
    b.append(chip, n, p);
    b.onclick = () => pick(id);
    list.append(b);
  };
  button(null, 'Unfinished', null, '');
  for (const m of materials) button(m.id, m.name, m.color, `$${m.costPerM2}/m²`);
  wrap.append(label, list);
  return wrap;
}

// ---------------------------------------------------------------------------
// Furniture panel
// ---------------------------------------------------------------------------

let catalogBuilding: BuildingType | 'all' = 'all';
let catalogRoom = '';

function furnitureSignature(): string {
  const f = editor.selectedFurniture();
  const check = f ? editor.getChecks().get(f.id) : undefined;
  return [
    editor.armedItem,
    catalogBuilding,
    catalogRoom,
    f ? `${f.id}:${f.rot}:${check?.errors.join(',')}:${check?.warnings.join(',')}` : '',
  ].join('|');
}

function renderFurniturePanel(): void {
  const f = editor.selectedFurniture();
  const item = f && catalogItem(f.item);
  if (f && item) {
    const check = editor.getChecks().get(f.id);
    el.options.append(h2(item.name), note(`${fmtMoney(item.cost)} · ${fmtMeters(item.w)} × ${fmtMeters(item.h)}`));
    for (const msg of check?.errors ?? []) el.options.append(note(msg, 'note bad'));
    for (const msg of check?.warnings ?? []) el.options.append(note(msg, 'note warn'));
    const row = document.createElement('div');
    row.className = 'action-grid';
    const rot = document.createElement('button');
    rot.type = 'button';
    rot.textContent = 'Rotate (R)';
    rot.onclick = () => editor.rotateSelectedFurniture();
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'danger';
    del.textContent = 'Delete';
    del.onclick = () => editor.deleteSelectedFurniture();
    row.append(rot, del);
    el.options.append(row);
  }

  el.options.append(h2('Catalog'));
  const filters = document.createElement('div');
  filters.className = 'filters';
  const bSel = document.createElement('select');
  bSel.setAttribute('aria-label', 'Building type');
  for (const [v, label] of [
    ['all', 'All buildings'],
    ['house', 'House'],
    ['store', 'Store'],
  ] as const) {
    bSel.append(new Option(label, v, false, catalogBuilding === v));
  }
  bSel.onchange = () => {
    catalogBuilding = bSel.value as BuildingType | 'all';
    refreshUi();
  };
  const rSel = document.createElement('select');
  rSel.setAttribute('aria-label', 'Room type');
  rSel.append(new Option('Any room', '', false, !catalogRoom));
  for (const t of ROOM_TYPES) rSel.append(new Option(t.name, t.id, false, t.id === catalogRoom));
  rSel.onchange = () => {
    catalogRoom = rSel.value;
    refreshUi();
  };
  filters.append(bSel, rSel);
  el.options.append(filters);

  const items = CATALOG.filter(
    (i) =>
      (catalogBuilding === 'all' || i.buildingTypes.includes(catalogBuilding)) &&
      (!catalogRoom || i.roomTypes.length === 0 || i.roomTypes.includes(catalogRoom)),
  );
  if (!items.length) el.options.append(note('Nothing matches these filters.'));
  let category = '';
  const list = document.createElement('div');
  list.className = 'swatches catalog';
  for (const i of items) {
    if (i.category !== category) {
      category = i.category;
      const c = document.createElement('div');
      c.className = 'swatch-title';
      c.textContent = category;
      list.append(c);
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.title = `${fmtMeters(i.w)} × ${fmtMeters(i.h)}`;
    b.setAttribute('aria-pressed', String(editor.armedItem === i.id));
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.style.background = i.color;
    const n = document.createElement('span');
    n.className = 'name';
    n.textContent = i.name;
    const pr = document.createElement('span');
    pr.className = 'price';
    pr.textContent = fmtMoney(i.cost);
    b.append(chip, n, pr);
    b.onclick = () => editor.armItem(editor.armedItem === i.id ? null : i.id);
    list.append(b);
  }
  el.options.append(list);
}

function roomSignature(room: Room | null): string {
  if (!room) return `none:${editor.getRooms().rooms.length}`;
  const d = editor.design;
  return [room.cells[0], room.cells.length, room.enclosed, room.type, roomFloor(d, room), roomWalls(d, room)].join('|');
}

function dl(target: HTMLElement, rows: Array<[string, string, string?]>): void {
  target.replaceChildren(
    ...rows.flatMap(([k, v, cls]) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      if (cls) {
        dt.className = cls;
        dd.className = cls;
      }
      return [dt, dd];
    }),
  );
}

function renderStats(): void {
  const s = stats(editor.design);
  const d = editor.design;
  const rooms = editor.getRooms().rooms;
  dl(el.stats, [
    ['Lot', `${fmtMeters(d.lotW)} × ${fmtMeters(d.lotH)}`],
    ['Footprint', `${s.footprintM2.toFixed(1)} m²`],
    ['Rooms', String(rooms.filter((r) => r.enclosed).length)],
    ['Exterior walls', `${s.exteriorWallM.toFixed(1)} m`],
    ['Interior walls', `${s.interiorWallM.toFixed(1)} m`],
    ['Doors', String(s.doors)],
    ['Windows', String(s.windows)],
  ]);

  const c = computeCost(d, rooms);
  const rows: Array<[string, string, string?]> = [];
  for (const [bucket, label] of [
    ['structure', 'Structure'],
    ['systems', 'Systems'],
    ['finishes', 'Finishes'],
    ['fixtures', 'Furniture'],
    ['decor', 'Decor'],
  ] as const) {
    rows.push([label, fmtMoney(c[bucket]), 'bucket']);
    for (const line of c.lines.filter((l) => l.bucket === bucket)) rows.push([line.label, fmtMoney(line.amount), 'line']);
  }
  rows.push(['Total', fmtMoney(c.total), 'total']);
  dl(el.cost, rows);
}

let lastTool: ToolId | null = null;
let lastOptionsKey = '';

function refreshUi(designChanged = false): void {
  const roomKey = editor.tool === 'room' ? roomSignature(editor.selectedRoom()) : '';
  const furnKey = editor.tool === 'furniture' ? furnitureSignature() : '';
  const optionsKey = `${editor.tool}|${editor.doorKind}|${editor.windowLen}|${roomKey}|${furnKey}`;
  if (editor.tool !== lastTool) {
    lastTool = editor.tool;
    renderTools();
  }
  if (optionsKey !== lastOptionsKey) {
    lastOptionsKey = optionsKey;
    renderOptions();
  }
  if (designChanged) renderStats();
  el.undo.disabled = !editor.history.canUndo;
  el.redo.disabled = !editor.history.canRedo;
  if (document.activeElement !== el.name) el.name.value = editor.design.name;

  el.hint.textContent = editor.message || (IS_TOUCH ? TOUCH_HINT + ' ' : '') + TOOL_HINTS[editor.tool];
  el.hint.classList.toggle('warn', Boolean(editor.message));
  const p = editor.pointer;
  el.pos.textContent = p ? `${(p.wx * CELL_M).toFixed(1)} m, ${(p.wy * CELL_M).toFixed(1)} m` : '';
}

async function switchTo(design: Design): Promise<void> {
  if (saveTimer !== undefined) await flushSave();
  editor.setDesign(design);
  renderStats();
  setLastDesignId(design.id);
  setSaveState('');
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function openNewDialog(): void {
  el.formNew.reset();
  el.dlgNew.returnValue = ''; // Esc keeps the previous value, so clear it
  el.dlgNew.showModal();
}

el.dlgNew.addEventListener('close', () => {
  if (el.dlgNew.returnValue !== 'ok') return;
  const f = new FormData(el.formNew);
  const toCells = (v: FormDataEntryValue | null) =>
    Math.min(200, Math.max(10, Math.round(Number(v) / CELL_M) || 40));
  const name = String(f.get('name') ?? '').trim() || 'Untitled design';
  const d = createDesign(name, toCells(f.get('w')), toCells(f.get('h')));
  void switchTo(d).then(() => flushSave());
});

async function openOpenDialog(): Promise<void> {
  if (saveTimer !== undefined) await flushSave();
  el.designList.replaceChildren();
  let designs: Awaited<ReturnType<typeof listDesigns>> = [];
  try {
    designs = await listDesigns();
  } catch {
    /* storage unavailable: show empty list */
  }
  if (designs.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No saved designs yet.';
    el.designList.append(li);
  }
  for (const s of designs) {
    const li = document.createElement('li');
    const meta = document.createElement('div');
    meta.className = 'meta';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = s.name;
    const date = document.createElement('div');
    date.className = 'date';
    date.textContent = `Edited ${new Date(s.updatedAt).toLocaleString()}`;
    meta.append(title, date);
    li.append(meta);

    if (s.id === editor.design.id) {
      const cur = document.createElement('span');
      cur.className = 'current';
      cur.textContent = 'Open now';
      li.append(cur);
    } else {
      const open = document.createElement('button');
      open.type = 'button';
      open.textContent = 'Open';
      open.onclick = async () => {
        const file = await loadDesign(s.id);
        if (!file) return;
        el.dlgOpen.close();
        await switchTo(deserialize(file));
      };
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'danger';
      del.textContent = 'Delete';
      del.onclick = async () => {
        if (!confirm(`Delete "${s.name}"? This can't be undone.`)) return;
        await deleteDesign(s.id);
        li.remove();
      };
      li.append(open, del);
    }
    el.designList.append(li);
  }
  if (!el.dlgOpen.open) el.dlgOpen.showModal();
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

window.addEventListener('keydown', (e) => {
  editor.setShiftHeld(e.shiftKey);
  if (isTyping(e) || document.querySelector('dialog[open]')) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (mod && key === 'z' && !e.shiftKey) {
    e.preventDefault();
    editor.undo();
  } else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
    e.preventDefault();
    editor.redo();
  } else if (mod) {
    return;
  } else if (e.code === 'Space') {
    e.preventDefault();
    editor.setSpaceHeld(true);
  } else if (key === 'escape') {
    editor.escape();
  } else if (key === 'home') {
    editor.fitView();
  } else if (key === 'delete' || key === 'backspace') {
    e.preventDefault();
    editor.deleteSelectedFurniture();
  } else if (key === 'r') {
    editor.rotate();
  } else if (key === '[') {
    editor.nudgeWindowLen(-1);
  } else if (key === ']') {
    editor.nudgeWindowLen(1);
  } else {
    const tool = TOOLS.find((t) => t.key.toLowerCase() === key);
    if (tool) editor.setTool(tool.id);
  }
});

window.addEventListener('keyup', (e) => {
  editor.setShiftHeld(e.shiftKey);
  if (e.code === 'Space') editor.setSpaceHeld(false);
});
window.addEventListener('blur', () => {
  editor.setSpaceHeld(false);
  editor.setShiftHeld(false);
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function loadInitialDesign(): Promise<Design> {
  const id = getLastDesignId();
  if (id) {
    try {
      const file = await loadDesign(id);
      if (file) return deserialize(file);
    } catch (err) {
      console.warn('Could not load last design', err);
    }
  }
  return createDesign('My first design');
}

const editor = new Editor($<HTMLCanvasElement>('blueprint'), await loadInitialDesign());
editor.onChange = (designChanged) => {
  refreshUi(designChanged);
  if (designChanged) scheduleSave();
};

el.name.addEventListener('input', () => {
  editor.design.name = el.name.value.trim() || 'Untitled design';
  scheduleSave();
});
el.name.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === 'Escape') el.name.blur();
});
$('btn-new').onclick = openNewDialog;
$('btn-open').onclick = () => void openOpenDialog();
$('btn-open-close').onclick = () => el.dlgOpen.close();
el.undo.onclick = () => editor.undo();
const removeBtn = $<HTMLButtonElement>('btn-remove');
removeBtn.onclick = () => {
  editor.removeMode = !editor.removeMode;
  removeBtn.setAttribute('aria-pressed', String(editor.removeMode));
  refreshUi();
};
const panelBtn = $<HTMLButtonElement>('btn-panel');
panelBtn.onclick = () => {
  const collapsed = $('sidebar').classList.toggle('collapsed');
  panelBtn.setAttribute('aria-expanded', String(!collapsed));
  panelBtn.textContent = collapsed ? 'Show panel' : 'Panel';
};
el.redo.onclick = () => editor.redo();
$('btn-enclose').onclick = () => editor.mutate(encloseFootprint);
$('btn-fit').onclick = () => editor.fitView();
window.addEventListener('beforeunload', () => {
  if (saveTimer !== undefined) void flushSave();
});

refreshUi(true);
