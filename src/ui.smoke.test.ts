// @vitest-environment jsdom
/**
 * Boots the real page in jsdom with a stub canvas and clicks through the main flows,
 * so runtime errors in UI and drawing code fail the build instead of a phone.
 */
import pageHtml from '../index.html?raw';
import { beforeAll, describe, expect, it } from 'vitest';

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function installStubs() {
  // Canvas 2D: remembers assigned properties, every method is a no-op.
  const store: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(store, {
    get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 40 }) : () => {}),
    set: (t, k, v) => {
      t[k] = v;
      return true;
    },
  });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
  HTMLCanvasElement.prototype.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON() {} }) as DOMRect;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 5)) as unknown as typeof requestAnimationFrame;
  window.confirm = () => true;
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & Record<string, unknown>;
  if (!proto.showModal || String(proto.showModal).includes('not implemented')) {
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    proto.close = function (this: HTMLDialogElement, v?: string) {
      this.removeAttribute('open');
      if (v !== undefined) this.returnValue = v;
      this.dispatchEvent(new Event('close'));
    };
  }
  if (typeof PointerEvent === 'undefined') {
    class PE extends MouseEvent {
      pointerId: number;
      pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? 'mouse';
      }
    }
    (globalThis as Record<string, unknown>).PointerEvent = PE;
  }
}

const canvas = () => document.getElementById('blueprint') as HTMLCanvasElement;
function pointer(type: string, x: number, y: number, opts: PointerEventInit = {}) {
  canvas().dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0, pointerId: 1, ...opts }));
}
/** Screen position of a cell's center, for the default 40×30 lot fitted to 800×600. */
const cell = (x: number, y: number): [number, number] => {
  const s = Math.min((800 - 96) / 40, (600 - 96) / 30);
  return [(800 - 40 * s) / 2 + (x + 0.5) * s, (600 - 30 * s) / 2 + (y + 0.5) * s];
};
function clickButton(text: string | RegExp) {
  const b = [...document.querySelectorAll('button')].find((el) =>
    typeof text === 'string' ? el.textContent?.trim().startsWith(text) : text.test(el.textContent ?? ''),
  );
  if (!b) throw new Error(`No button "${String(text)}"`);
  b.click();
}

beforeAll(async () => {
  installStubs();
  const html = pageHtml;
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));
  await import('./main');
  await tick();
});

describe('UI smoke test', () => {
  it('opens the sample house on first visit', () => {
    expect((document.getElementById('design-name') as HTMLInputElement).value).toBe('Sample house');
    expect(document.getElementById('cost')!.textContent).toMatch(/Total/);
  });

  it('draws with every tool and places things', async () => {
    for (const tool of ['Footprint', 'Wall', 'Door', 'Window', 'Room', 'Furniture', 'Erase']) {
      clickButton(tool);
      pointer('pointermove', ...cell(16, 16));
      await tick(10);
    }
    // Paint footprint outside the house, then wall it.
    clickButton('Footprint');
    pointer('pointerdown', ...cell(30, 22));
    pointer('pointermove', ...cell(35, 26));
    pointer('pointerup', ...cell(35, 26));
    clickButton('Wall the footprint');
    // Place a window on the new building's bottom wall.
    clickButton('Window');
    const [wx, wy] = cell(32, 26);
    pointer('pointerdown', wx, wy + 8);
    pointer('pointerup', wx, wy + 8);
    await tick();
    expect(document.getElementById('stats')!.textContent).toMatch(/Windows/);
  });

  it('selects a room and changes its floor', async () => {
    clickButton('Room');
    pointer('pointerdown', ...cell(18, 17));
    pointer('pointerup', ...cell(18, 17));
    await tick();
    expect(document.getElementById('options')!.textContent).toMatch(/Living room/);
    clickButton('Marble');
    await tick();
    expect(document.getElementById('cost')!.textContent).toMatch(/Flooring/);
  });

  it('places, rotates and deletes furniture', async () => {
    clickButton('Furniture');
    await tick();
    clickButton('Potted plant');
    pointer('pointermove', ...cell(25, 17));
    pointer('pointerdown', ...cell(25, 17));
    pointer('pointerup', ...cell(25, 17));
    await tick();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    pointer('pointerdown', ...cell(25, 17));
    pointer('pointerup', ...cell(25, 17));
    await tick();
    expect(document.getElementById('options')!.textContent).toMatch(/Potted plant/);
    clickButton('Rotate');
    clickButton('Delete');
    await tick();
  });

  it('pinch-zooms with two fingers', async () => {
    pointer('pointerdown', 300, 300, { pointerId: 11, pointerType: 'touch' });
    pointer('pointerdown', 400, 300, { pointerId: 12, pointerType: 'touch' });
    pointer('pointermove', 450, 300, { pointerId: 12, pointerType: 'touch' });
    pointer('pointerup', 450, 300, { pointerId: 12, pointerType: 'touch' });
    pointer('pointerup', 300, 300, { pointerId: 11, pointerType: 'touch' });
    clickButton('Fit view');
    await tick();
  });

  it('runs and plays back a simulation', async () => {
    clickButton('Run simulation');
    await tick(60);
    expect(document.querySelector('.score .num')?.textContent).toMatch(/^\d+$/);
    clickButton('16×');
    clickButton('Heatmap');
    await tick(60);
    clickButton(/^(Pause|Play|Replay)$/);
    clickButton('Close');
    await tick();
    expect(document.querySelector('.score')).toBeNull();
  });

  it('undoes and redoes', async () => {
    clickButton('Undo');
    clickButton('Redo');
    await tick();
  });

  it('creates a new design from the store sample', async () => {
    clickButton('New');
    const form = document.getElementById('form-new') as HTMLFormElement;
    (form.elements.namedItem('start') as HTMLSelectElement).value = 'store';
    (document.getElementById('dlg-new') as HTMLDialogElement).close('ok');
    await tick(60);
    expect((document.getElementById('design-name') as HTMLInputElement).value).toBe('Sample store');
    clickButton('Run simulation');
    await tick(60);
    expect(document.querySelector('.score .num')).not.toBeNull();
  });
});

describe('client briefs', () => {
  it('starts a practice brief, submits it and shows a report card', async () => {
    clickButton('New');
    const form = document.getElementById('form-new') as HTMLFormElement;
    (form.elements.namedItem('start') as HTMLSelectElement).value = 'brief:starter-home';
    (document.getElementById('dlg-new') as HTMLDialogElement).close('ok');
    await tick(60);
    expect(document.getElementById('brief-section')!.hidden).toBe(false);
    expect(document.getElementById('brief')!.textContent).toMatch(/Maya & Theo/);
    clickButton('Submit to client');
    await tick(30);
    expect(document.getElementById('report')!.textContent).toMatch(/verdict/);
    clickButton('Watch the simulation');
    await tick(30);
  });
});
