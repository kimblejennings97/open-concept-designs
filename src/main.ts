import './style.css';
import { type DoorKind, Editor, TOOL_HINTS, type ToolId } from './editor/editor';
import { type Design, OPENING_SPECS, createDesign, deserialize, encloseFootprint, serialize, stats } from './model/design';
import { CELL_M, fmtMeters } from './model/grid';
import { deleteDesign, listDesigns, loadDesign, saveDesign } from './storage/db';
import { getLastDesignId, setLastDesignId } from './storage/settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const TOOLS: Array<{ id: ToolId; label: string; key: string }> = [
  { id: 'footprint', label: 'Footprint', key: 'F' },
  { id: 'wall', label: 'Wall', key: 'W' },
  { id: 'door', label: 'Door', key: 'D' },
  { id: 'window', label: 'Window', key: 'N' },
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
  }
}

function renderStats(): void {
  const s = stats(editor.design);
  const d = editor.design;
  const rows: Array<[string, string]> = [
    ['Lot', `${fmtMeters(d.lotW)} × ${fmtMeters(d.lotH)}`],
    ['Footprint', `${s.footprintM2.toFixed(1)} m²`],
    ['Exterior walls', `${s.exteriorWallM.toFixed(1)} m`],
    ['Interior walls', `${s.interiorWallM.toFixed(1)} m`],
    ['Doors', String(s.doors)],
    ['Windows', String(s.windows)],
  ];
  el.stats.replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      return [dt, dd];
    }),
  );
}

let lastTool: ToolId | null = null;
let lastOptionsKey = '';

function refreshUi(designChanged = false): void {
  const optionsKey = `${editor.tool}|${editor.doorKind}|${editor.windowLen}`;
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

  el.hint.textContent = editor.message || TOOL_HINTS[editor.tool];
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
  } else if (key === 'home') {
    editor.fitView();
  } else if (key === 'r') {
    editor.flipDoor();
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
el.redo.onclick = () => editor.redo();
$('btn-enclose').onclick = () => editor.mutate(encloseFootprint);
$('btn-fit').onclick = () => editor.fitView();
window.addEventListener('beforeunload', () => {
  if (saveTimer !== undefined) void flushSave();
});

refreshUi(true);
