import {
  type Design,
  type Opening,
  OPENING_SPECS,
  addOpening,
  addWalls,
  openingEdges,
  openingOnEdge,
  openingProblem,
  paintFootprint,
  removeOpening,
  removeWalls,
  restore,
  snapshot,
  wallKind,
  edgeInLot,
  newId,
} from '../model/design';
import { type Edge, edgeKey, fmtMeters, lineEdges, nearestEdge, parseEdge } from '../model/grid';
import { History } from './history';

export type ToolId = 'footprint' | 'wall' | 'door' | 'window' | 'erase';
export type DoorKind = 'door' | 'double-door';

export const TOOL_HINTS: Record<ToolId, string> = {
  footprint: 'Drag to paint the building footprint. Right-drag (or Shift-drag) to clear.',
  wall: 'Drag between grid points to draw a wall. Right-drag (or Shift-drag) to remove walls.',
  door: 'Click a wall to place a door. R flips the swing. Right-click a door to remove it.',
  window: 'Click an exterior wall to place a window. [ and ] change the width. Right-click to remove.',
  erase: 'Click or drag over doors, windows and walls to remove them.',
};

const MIN_SCALE = 4;
const MAX_SCALE = 120;
const EDGE_PICK = 0.45; // cells

const COLORS = {
  outside: '#0b1726',
  lot: '#13294a',
  gridMinor: 'rgba(160, 200, 255, 0.07)',
  gridMeter: 'rgba(160, 200, 255, 0.16)',
  gridFive: 'rgba(160, 200, 255, 0.3)',
  lotBorder: 'rgba(200, 225, 255, 0.65)',
  footprint: 'rgba(110, 170, 255, 0.24)',
  wallExt: '#f1f5fb',
  wallInt: '#a9c0e0',
  window: '#7fd4ff',
  door: '#ffcf70',
  ok: 'rgba(110, 230, 150, 0.95)',
  bad: 'rgba(255, 105, 105, 0.95)',
  okFill: 'rgba(110, 230, 150, 0.22)',
  badFill: 'rgba(255, 105, 105, 0.22)',
  labelBg: 'rgba(8, 16, 28, 0.85)',
  labelText: '#e8f0fb',
};

type Drag =
  | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | { kind: 'rect'; add: boolean; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'line'; add: boolean; ax: number; ay: number; bx: number; by: number }
  | { kind: 'erase'; before: string; changed: boolean; layer: 'opening' | 'wall' | null };

export class Editor {
  design: Design;
  readonly history = new History();

  tool: ToolId = 'footprint';
  doorKind: DoorKind = 'door';
  windowLen = OPENING_SPECS.window.defaultLen;
  doorFlip = false;

  /** Short message about the current hover (e.g. why a door can't go here). */
  message = '';
  /** Pointer position in cells, or null when off-canvas. */
  pointer: { wx: number; wy: number } | null = null;

  /** Called after anything changes. `designChanged` is true when the design itself was edited. */
  onChange: (designChanged: boolean) => void = () => {};

  private readonly ctx: CanvasRenderingContext2D;
  private cam = { scale: 20, ox: 0, oy: 0 };
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private drag: Drag | null = null;
  private spaceHeld = false;
  private shiftHeld = false;
  private frame = 0;

  constructor(private readonly canvas: HTMLCanvasElement, design: Design) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not supported');
    this.ctx = ctx;
    this.design = design;

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.fitView();

    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointercancel', () => this.cancelDrag());
    canvas.addEventListener('pointerleave', () => {
      if (!this.drag) {
        this.pointer = null;
        this.message = '';
        this.changed(false);
      }
    });
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  setDesign(d: Design): void {
    this.design = d;
    this.drag = null;
    this.history.clear();
    this.fitView();
    this.changed(false);
  }

  setTool(t: ToolId): void {
    this.cancelDrag();
    this.tool = t;
    this.message = '';
    this.updateCursor();
    this.changed(false);
  }

  setSpaceHeld(held: boolean): void {
    this.spaceHeld = held;
    this.updateCursor();
  }

  setShiftHeld(held: boolean): void {
    if (this.shiftHeld === held) return;
    this.shiftHeld = held;
    this.requestRender();
  }

  flipDoor(): void {
    this.doorFlip = !this.doorFlip;
    this.changed(false);
  }

  nudgeWindowLen(delta: number): void {
    const s = OPENING_SPECS.window;
    this.windowLen = Math.min(s.maxLen, Math.max(s.minLen, this.windowLen + delta));
    this.changed(false);
  }

  /** Run a design mutation as one undoable step. */
  mutate(fn: (d: Design) => boolean): boolean {
    const before = snapshot(this.design);
    if (!fn(this.design)) return false;
    this.history.record(before);
    this.changed(true);
    return true;
  }

  undo(): void {
    this.cancelDrag();
    const prev = this.history.undo(snapshot(this.design));
    if (prev) this.replaceKeepingHistory(prev);
  }

  redo(): void {
    this.cancelDrag();
    const next = this.history.redo(snapshot(this.design));
    if (next) this.replaceKeepingHistory(next);
  }

  fitView(): void {
    const { lotW, lotH } = this.design;
    const pad = 48;
    const s = Math.min((this.cssW - pad * 2) / lotW, (this.cssH - pad * 2) / lotH);
    this.cam.scale = clamp(Number.isFinite(s) && s > 0 ? s : 20, MIN_SCALE, MAX_SCALE);
    this.cam.ox = (this.cssW - lotW * this.cam.scale) / 2;
    this.cam.oy = (this.cssH - lotH * this.cam.scale) / 2;
    this.requestRender();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private replaceKeepingHistory(s: string): void {
    this.design = restore(s);
    this.changed(true);
  }

  private changed(designChanged: boolean): void {
    this.requestRender();
    this.onChange(designChanged);
  }

  private requestRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const firstSize = this.cssW === 0;
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    if (firstSize) this.fitView();
    this.requestRender();
  }

  private updateCursor(): void {
    this.canvas.style.cursor = this.drag?.kind === 'pan' ? 'grabbing' : this.spaceHeld ? 'grab' : 'crosshair';
  }

  private toWorld(e: PointerEvent | WheelEvent): { wx: number; wy: number } {
    const r = this.canvas.getBoundingClientRect();
    return {
      wx: (e.clientX - r.left - this.cam.ox) / this.cam.scale,
      wy: (e.clientY - r.top - this.cam.oy) / this.cam.scale,
    };
  }

  private cancelDrag(): void {
    const erased = this.drag?.kind === 'erase' && this.drag.changed;
    if (erased && this.drag?.kind === 'erase') this.history.record(this.drag.before);
    this.drag = null;
    this.updateCursor();
    if (erased) this.changed(true);
    else this.requestRender();
  }

  private onPointerDown(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.toWorld(e);
    this.pointer = p;
    const remove = e.button === 2 || e.shiftKey;

    if (e.button === 1 || (e.button === 0 && this.spaceHeld)) {
      this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: this.cam.ox, oy: this.cam.oy };
      this.updateCursor();
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;

    switch (this.tool) {
      case 'footprint': {
        const x = Math.floor(p.wx);
        const y = Math.floor(p.wy);
        this.drag = { kind: 'rect', add: !remove, x0: x, y0: y, x1: x, y1: y };
        break;
      }
      case 'wall': {
        const x = Math.round(p.wx);
        const y = Math.round(p.wy);
        this.drag = { kind: 'line', add: !remove, ax: x, ay: y, bx: x, by: y };
        break;
      }
      case 'door':
      case 'window': {
        if (remove) {
          const op = this.openingUnder(p.wx, p.wy);
          if (op) this.mutate((d) => removeOpening(d, op.id));
        } else {
          const op = this.openingPreview(p.wx, p.wy);
          if (op && openingProblem(this.design, op) === null) {
            this.mutate((d) => addOpening(d, { ...op, id: newId() }));
          }
        }
        break;
      }
      case 'erase': {
        this.drag = { kind: 'erase', before: snapshot(this.design), changed: false, layer: null };
        this.eraseAt(p.wx, p.wy);
        break;
      }
    }
    this.changed(false);
  }

  private onPointerMove(e: PointerEvent): void {
    const p = this.toWorld(e);
    this.pointer = p;
    const drag = this.drag;
    if (drag?.kind === 'pan') {
      this.cam.ox = drag.ox + (e.clientX - drag.sx);
      this.cam.oy = drag.oy + (e.clientY - drag.sy);
    } else if (drag?.kind === 'rect') {
      drag.x1 = Math.floor(p.wx);
      drag.y1 = Math.floor(p.wy);
    } else if (drag?.kind === 'line') {
      // Constrain to the dominant axis.
      const x = Math.round(p.wx);
      const y = Math.round(p.wy);
      if (Math.abs(x - drag.ax) >= Math.abs(y - drag.ay)) {
        drag.bx = x;
        drag.by = drag.ay;
      } else {
        drag.bx = drag.ax;
        drag.by = y;
      }
    } else if (drag?.kind === 'erase') {
      this.eraseAt(p.wx, p.wy);
    }
    this.updateMessage();
    this.changed(false);
  }

  private onPointerUp(e: PointerEvent): void {
    const drag = this.drag;
    this.drag = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (drag?.kind === 'rect') {
      this.mutate((d) => paintFootprint(d, drag.x0, drag.y0, drag.x1, drag.y1, drag.add));
    } else if (drag?.kind === 'line') {
      const keys = lineEdges(drag.ax, drag.ay, drag.bx, drag.by);
      this.mutate((d) => (drag.add ? addWalls(d, keys) : removeWalls(d, keys)));
    } else if (drag?.kind === 'erase' && drag.changed) {
      this.history.record(drag.before);
      this.changed(true);
    }
    this.updateCursor();
    this.changed(false);
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const { wx, wy } = this.toWorld(e);
    const next = clamp(this.cam.scale * Math.exp(-e.deltaY * 0.0015), MIN_SCALE, MAX_SCALE);
    const r = this.canvas.getBoundingClientRect();
    this.cam.scale = next;
    this.cam.ox = e.clientX - r.left - wx * next;
    this.cam.oy = e.clientY - r.top - wy * next;
    this.requestRender();
  }

  /** Erase whatever is under the pointer. Within one drag, sticks to the first layer erased (openings or walls). */
  private eraseAt(wx: number, wy: number): void {
    const drag = this.drag;
    if (drag?.kind !== 'erase') return;
    const edge = this.edgeUnder(wx, wy);
    if (!edge) return;
    const key = edgeKey(edge.o, edge.x, edge.y);
    const op = openingOnEdge(this.design, key);
    if (op && drag.layer !== 'wall') {
      removeOpening(this.design, op.id);
      drag.layer = 'opening';
      drag.changed = true;
    } else if (!op && this.design.walls.has(key) && drag.layer !== 'opening') {
      removeWalls(this.design, [key]);
      drag.layer = 'wall';
      drag.changed = true;
    }
  }

  private edgeUnder(wx: number, wy: number): Edge | null {
    const e = nearestEdge(wx, wy, EDGE_PICK);
    return e && edgeInLot(this.design, e) ? e : null;
  }

  private openingUnder(wx: number, wy: number): Opening | undefined {
    const e = this.edgeUnder(wx, wy);
    return e ? openingOnEdge(this.design, edgeKey(e.o, e.x, e.y)) : undefined;
  }

  /** The opening the door/window tool would place at this point (not yet validated). */
  private openingPreview(wx: number, wy: number): Opening | null {
    if (this.tool !== 'door' && this.tool !== 'window') return null;
    const e = nearestEdge(wx, wy, EDGE_PICK);
    if (!e) return null;
    const kind = this.tool === 'window' ? 'window' : this.doorKind;
    const len = kind === 'window' ? this.windowLen : OPENING_SPECS[kind].defaultLen;
    const along = e.o === 'h' ? wx : wy;
    const start = Math.round(along - len / 2);
    return {
      id: 'preview',
      kind,
      o: e.o,
      x: e.o === 'h' ? start : e.x,
      y: e.o === 'h' ? e.y : start,
      len,
      flip: this.doorFlip,
    };
  }

  private updateMessage(): void {
    this.message = '';
    const p = this.pointer;
    if (!p || this.drag) return;
    const op = this.openingPreview(p.wx, p.wy);
    if (op) this.message = openingProblem(this.design, op) ?? '';
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  private draw(): void {
    const { ctx, cam, design: d } = this;
    const s = cam.scale;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COLORS.outside;
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    // World space: 1 unit = 1 cell.
    ctx.save();
    ctx.translate(cam.ox, cam.oy);
    ctx.scale(s, s);

    ctx.fillStyle = COLORS.lot;
    ctx.fillRect(0, 0, d.lotW, d.lotH);

    ctx.beginPath();
    for (const k of d.footprint) {
      const i = k.indexOf(',');
      ctx.rect(Number(k.slice(0, i)), Number(k.slice(i + 1)), 1, 1);
    }
    ctx.fillStyle = COLORS.footprint;
    ctx.fill();
    ctx.restore();

    this.drawGrid();

    ctx.save();
    ctx.translate(cam.ox, cam.oy);
    ctx.scale(s, s);
    this.drawWalls();
    for (const op of d.openings) this.drawOpening(op, null);
    this.drawPreview();
    ctx.restore();

    this.drawLabels();
  }

  private drawGrid(): void {
    const { ctx, cam, design: d } = this;
    const s = cam.scale;
    const x0 = Math.max(0, Math.floor(-cam.ox / s));
    const x1 = Math.min(d.lotW, Math.ceil((this.cssW - cam.ox) / s));
    const y0 = Math.max(0, Math.floor(-cam.oy / s));
    const y1 = Math.min(d.lotH, Math.ceil((this.cssH - cam.oy) / s));
    const px = (v: number, o: number) => Math.round(v * s + o) + 0.5;

    const pass = (style: string, test: (i: number) => boolean) => {
      ctx.beginPath();
      for (let x = x0; x <= x1; x++) {
        if (!test(x)) continue;
        ctx.moveTo(px(x, cam.ox), cam.oy);
        ctx.lineTo(px(x, cam.ox), cam.oy + d.lotH * s);
      }
      for (let y = y0; y <= y1; y++) {
        if (!test(y)) continue;
        ctx.moveTo(cam.ox, px(y, cam.oy));
        ctx.lineTo(cam.ox + d.lotW * s, px(y, cam.oy));
      }
      ctx.strokeStyle = style;
      ctx.lineWidth = 1;
      ctx.stroke();
    };
    if (s >= 8) pass(COLORS.gridMinor, (i) => i % 2 !== 0);
    pass(COLORS.gridMeter, (i) => i % 2 === 0 && i % 10 !== 0);
    pass(COLORS.gridFive, (i) => i % 10 === 0);

    ctx.strokeStyle = COLORS.lotBorder;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(cam.ox, cam.oy, d.lotW * s, d.lotH * s);
    ctx.setLineDash([]);
  }

  private drawWalls(): void {
    const { ctx, design: d } = this;
    const openingKeys = new Set(d.openings.flatMap((op) => openingEdges(op)));
    const isOpen = (o: 'h' | 'v', x: number, y: number) => openingKeys.has(edgeKey(o, x, y));

    for (const pass of ['interior', 'exterior'] as const) {
      ctx.fillStyle = pass === 'exterior' ? COLORS.wallExt : COLORS.wallInt;
      const t = pass === 'exterior' ? 0.5 : 0.3;
      for (const k of d.walls) {
        if (openingKeys.has(k) || wallKind(d, k) !== pass) continue;
        const e = parseEdge(k);
        // Square end caps fill corners, except where the wall runs into a door or window.
        if (e.o === 'h') {
          const capL = isOpen('h', e.x - 1, e.y) ? 0 : t / 2;
          const capR = isOpen('h', e.x + 1, e.y) ? 0 : t / 2;
          ctx.fillRect(e.x - capL, e.y - t / 2, 1 + capL + capR, t);
        } else {
          const capT = isOpen('v', e.x, e.y - 1) ? 0 : t / 2;
          const capB = isOpen('v', e.x, e.y + 1) ? 0 : t / 2;
          ctx.fillRect(e.x - t / 2, e.y - capT, t, 1 + capT + capB);
        }
      }
    }
  }

  /** Draw an opening. `tint` overrides colors for placement previews. */
  private drawOpening(op: Opening, tint: string | null): void {
    const { ctx } = this;
    const lw = 1.5 / this.cam.scale;
    const ext = wallKind(this.design, openingEdges(op)[0]) === 'exterior';
    const t = ext ? 0.5 : 0.3;
    // Unit vectors along the opening and toward the swing side.
    const ax = op.o === 'h' ? 1 : 0;
    const ay = op.o === 'h' ? 0 : 1;
    const side = op.flip ? -1 : 1;
    const nx = op.o === 'h' ? 0 : side;
    const ny = op.o === 'h' ? side : 0;
    const ex = op.x + ax * op.len;
    const ey = op.y + ay * op.len;

    if (op.kind === 'window') {
      const color = tint ?? COLORS.window;
      ctx.fillStyle = withAlpha(color, 0.25);
      if (op.o === 'h') ctx.fillRect(op.x, op.y - t / 2, op.len, t);
      else ctx.fillRect(op.x - t / 2, op.y, t, op.len);
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (const off of [-t / 2, 0, t / 2]) {
        const ox = op.o === 'h' ? 0 : off;
        const oy = op.o === 'h' ? off : 0;
        ctx.moveTo(op.x + ox, op.y + oy);
        ctx.lineTo(ex + ox, ey + oy);
      }
      ctx.stroke();
      return;
    }

    const color = tint ?? COLORS.door;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    // Threshold
    ctx.setLineDash([0.15, 0.15]);
    ctx.beginPath();
    ctx.moveTo(op.x, op.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);

    const leaves: Array<{ hx: number; hy: number; dirX: number; dirY: number; r: number }> =
      op.kind === 'double-door'
        ? [
            { hx: op.x, hy: op.y, dirX: ax, dirY: ay, r: op.len / 2 },
            { hx: ex, hy: ey, dirX: -ax, dirY: -ay, r: op.len / 2 },
          ]
        : [{ hx: op.x, hy: op.y, dirX: ax, dirY: ay, r: op.len }];

    for (const leaf of leaves) {
      let aClosed = Math.atan2(leaf.dirY, leaf.dirX);
      let aOpen = Math.atan2(ny, nx);
      if (Math.abs(aOpen - aClosed) > Math.PI) {
        if (aOpen < aClosed) aOpen += Math.PI * 2;
        else aClosed += Math.PI * 2;
      }
      ctx.beginPath();
      ctx.moveTo(leaf.hx, leaf.hy);
      ctx.lineTo(leaf.hx + nx * leaf.r, leaf.hy + ny * leaf.r);
      ctx.lineWidth = lw * 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(leaf.hx, leaf.hy, leaf.r, Math.min(aClosed, aOpen), Math.max(aClosed, aOpen));
      ctx.lineWidth = lw;
      ctx.stroke();
    }
  }

  private drawPreview(): void {
    const { ctx, drag, pointer } = this;
    const lw = 2 / this.cam.scale;

    if (drag?.kind === 'rect') {
      const x = Math.min(drag.x0, drag.x1);
      const y = Math.min(drag.y0, drag.y1);
      const w = Math.abs(drag.x1 - drag.x0) + 1;
      const h = Math.abs(drag.y1 - drag.y0) + 1;
      ctx.fillStyle = drag.add ? COLORS.okFill : COLORS.badFill;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = drag.add ? COLORS.ok : COLORS.bad;
      ctx.lineWidth = lw;
      ctx.strokeRect(x, y, w, h);
      return;
    }

    if (drag?.kind === 'line') {
      ctx.strokeStyle = drag.add ? COLORS.ok : COLORS.bad;
      ctx.lineWidth = 0.35;
      ctx.lineCap = 'square';
      ctx.beginPath();
      ctx.moveTo(drag.ax, drag.ay);
      ctx.lineTo(drag.bx, drag.by);
      ctx.stroke();
      ctx.lineCap = 'butt';
      return;
    }

    if (drag || !pointer) return;

    if (this.tool === 'wall') {
      ctx.fillStyle = this.shiftHeld ? COLORS.bad : COLORS.ok;
      ctx.beginPath();
      ctx.arc(Math.round(pointer.wx), Math.round(pointer.wy), 5 / this.cam.scale, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.tool === 'footprint') {
      ctx.strokeStyle = this.shiftHeld ? COLORS.bad : COLORS.ok;
      ctx.lineWidth = lw;
      ctx.strokeRect(Math.floor(pointer.wx), Math.floor(pointer.wy), 1, 1);
    } else if (this.tool === 'door' || this.tool === 'window') {
      const op = this.openingPreview(pointer.wx, pointer.wy);
      if (op) this.drawOpening(op, openingProblem(this.design, op) ? COLORS.bad : COLORS.ok);
    } else if (this.tool === 'erase') {
      const e = this.edgeUnder(pointer.wx, pointer.wy);
      if (!e) return;
      const key = edgeKey(e.o, e.x, e.y);
      const op = openingOnEdge(this.design, key);
      if (!op && !this.design.walls.has(key)) return;
      const edges = op ? openingEdges(op) : [key];
      ctx.fillStyle = COLORS.bad;
      for (const k of edges) {
        const ed = parseEdge(k);
        if (ed.o === 'h') ctx.fillRect(ed.x, ed.y - 0.3, 1, 0.6);
        else ctx.fillRect(ed.x - 0.3, ed.y, 0.6, 1);
      }
    }
  }

  private drawLabels(): void {
    const { drag, pointer } = this;
    if (!pointer) return;
    const r = this.toScreen(pointer.wx, pointer.wy);
    let text = '';
    if (drag?.kind === 'rect') {
      const w = Math.abs(drag.x1 - drag.x0) + 1;
      const h = Math.abs(drag.y1 - drag.y0) + 1;
      text = `${fmtMeters(w)} × ${fmtMeters(h)}`;
    } else if (drag?.kind === 'line') {
      text = fmtMeters(Math.abs(drag.bx - drag.ax) + Math.abs(drag.by - drag.ay));
    } else if (!drag && this.tool === 'window') {
      text = `Window ${fmtMeters(this.windowLen)}`;
    }
    if (!text) return;
    const { ctx } = this;
    ctx.font = '600 12px system-ui, sans-serif';
    const w = ctx.measureText(text).width + 12;
    const x = Math.min(r.x + 14, this.cssW - w - 4);
    const y = Math.max(r.y - 30, 4);
    ctx.fillStyle = COLORS.labelBg;
    roundRect(ctx, x, y, w, 22, 4);
    ctx.fill();
    ctx.fillStyle = COLORS.labelText;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 6, y + 11);
  }

  private toScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: wx * this.cam.scale + this.cam.ox, y: wy * this.cam.scale + this.cam.oy };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function withAlpha(rgba: string, a: number): string {
  if (rgba.startsWith('#') && rgba.length === 7) {
    const n = parseInt(rgba.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  return rgba.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, `rgba($1,$2,$3, ${a})`);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
