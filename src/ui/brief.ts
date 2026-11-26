/** Client brief panel (live checklist + budget) and the report card shown after submitting. */
import { type Brief, THEME_NAMES } from '../data/catalog';
import type { Editor } from '../editor/editor';
import type { Evaluation } from '../game/evaluate';
import { computeCost, fmtMoney } from '../model/cost';
import { OVER_BUDGET_LIMIT, checkBrief } from '../model/scoring';

function elt<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function btn(text: string, onclick: () => void, cls = ''): HTMLButtonElement {
  const b = elt('button', cls, text);
  b.type = 'button';
  b.onclick = onclick;
  return b;
}

export const starsText = (n: number): string => '★'.repeat(n) + '☆'.repeat(3 - n);

/** Live brief panel: who the client is, budget meter, requirement checklist, submit. */
export function renderBriefPanel(root: HTMLElement, editor: Editor, brief: Brief, onSubmit: () => void): void {
  const d = editor.design;
  const rooms = editor.getRooms();
  const cost = computeCost(d, rooms.rooms).total;
  const checks = checkBrief(d, rooms, brief);

  const who = elt('div', 'client');
  who.append(elt('strong', '', brief.client), elt('span', 'muted', ` · ${brief.clientRole}`));
  const title = elt('div', 'brief-title', brief.title);
  const summary = elt('details', 'brief-summary');
  summary.append(elt('summary', '', 'What they said'), elt('p', '', `“${brief.summary}”`));

  const ratio = cost / brief.budget;
  const meter = elt('div', 'meter');
  const fill = elt('div', 'meter-fill');
  fill.style.width = `${Math.min(100, ratio * 100)}%`;
  fill.classList.add(ratio <= 1 ? 'ok' : ratio <= 1 + OVER_BUDGET_LIMIT ? 'warn' : 'bad');
  meter.append(fill);
  const budget = elt('div', 'budget-line');
  budget.append(elt('span', '', `${fmtMoney(cost)} of ${fmtMoney(brief.budget)}`), elt('span', 'muted', `fee ${fmtMoney(brief.fee)}`));

  const theme = elt('div', 'muted small', `Style: ${THEME_NAMES[brief.theme] ?? brief.theme}`);

  const list = elt('ul', 'checklist');
  for (const c of checks) {
    const li = elt('li', c.met ? 'met' : 'unmet');
    li.append(elt('span', 'mark', c.met ? '✓' : '○'), elt('span', '', c.label));
    if (c.detail) li.append(elt('span', 'muted small', ` (${c.detail})`));
    list.append(li);
  }

  const tooExpensive = ratio > 1 + OVER_BUDGET_LIMIT;
  const submit = btn('Submit to client', onSubmit, 'primary wide-btn');
  submit.disabled = tooExpensive;
  const parts: HTMLElement[] = [who, title, summary, budget, meter, theme, list, submit];
  if (tooExpensive) parts.push(elt('p', 'note warn', 'More than 10% over budget: cut costs before submitting.'));
  root.replaceChildren(...parts);
}

export interface ReportActions {
  watch: () => void;
  close: () => void;
  /** Career only: bank the fee and go back to the office. */
  collect?: () => void;
  collectLabel?: string;
}

/** Fill the report-card dialog. */
export function renderReport(root: HTMLElement, brief: Brief, ev: Evaluation, actions: ReportActions): void {
  const r = ev.result;
  const head = elt('div', 'report-head');
  head.append(elt('h2', '', `${brief.client}’s verdict`), elt('div', 'muted', brief.title));
  const stars = elt('div', `stars s${r.stars}`, starsText(r.stars));
  const total = elt('div', 'report-total');
  total.append(elt('span', 'num', String(r.total)), elt('span', 'muted', '/100'));
  const verdict = elt(
    'p',
    r.passed ? 'verdict pass' : 'verdict fail',
    r.passed
      ? r.stars === 3
        ? 'They love it.'
        : r.stars === 2
          ? 'Happy client.'
          : 'They’ll take it, but they’re not thrilled.'
      : 'They turned it down.',
  );

  const bars = elt('div', 'report-bars');
  const labels = { flow: 'Flow', aesthetics: 'Looks', budget: 'Budget', brief: 'Brief' } as const;
  for (const k of ['flow', 'aesthetics', 'budget', 'brief'] as const) {
    const row = elt('div', 'bar-row');
    const bar = elt('div', 'meter');
    const fill = elt('div', 'meter-fill');
    const v = r.parts[k];
    fill.style.width = `${v}%`;
    fill.classList.add(v >= 75 ? 'ok' : v >= 50 ? 'warn' : 'bad');
    bar.append(fill);
    row.append(elt('span', '', labels[k]), bar, elt('span', 'num-sm', String(v)), elt('span', 'muted small', `×${Math.round(brief.weights[k] * 100)}%`));
    bars.append(row);
  }

  const issues = elt('ol', 'issues');
  for (const iss of r.issues.slice(0, 3)) {
    const li = elt('li');
    li.append(elt('span', `tag ${iss.category}`, labels[iss.category]), document.createTextNode(` ${iss.text}`));
    issues.append(li);
  }
  if (!r.issues.length) issues.append(elt('li', '', 'Not a single complaint.'));

  const money = elt('p', 'fee', r.passed ? `Fee earned: ${fmtMoney(r.fee)}` : 'No fee for a rejected design.');
  const cost = elt('p', 'muted small', `Build cost ${fmtMoney(r.cost)} of ${fmtMoney(brief.budget)} budget.`);

  const buttons = elt('div', 'dialog-actions');
  buttons.append(btn('Watch the simulation', actions.watch), btn('Keep editing', actions.close));
  if (actions.collect) buttons.append(btn(actions.collectLabel ?? 'Collect fee', actions.collect, 'primary'));
  root.replaceChildren(head, stars, total, verdict, bars, elt('h3', '', 'Top issues'), issues, money, cost, buttons);
}
