/** The career "office": firm status, offer board, objectives and the next-tier teaser. */
import { type Brief, THEME_NAMES } from '../data/catalog';
import { type CareerKind, type CareerSave, type Payout, objectiveStatus, offers, tierInfo } from '../game/career';
import { fmtMoney } from '../model/cost';
import { fmtLen } from '../model/units';
import { starsText } from './brief';

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

export interface OfficeActions {
  /** Which save slot is shown. */
  kind: CareerKind;
  switchKind: (kind: CareerKind) => void;
  start: (firm: string) => void;
  takeJob: (brief: Brief) => void;
  continueJob: () => void;
  reset: () => void;
  close: () => void;
}

export function renderOffice(
  root: HTMLElement,
  save: CareerSave | null,
  actions: OfficeActions,
  payout?: { payout: Payout; brief: Brief } | null,
): void {
  const tabs = elt('div', 'segmented office-tabs');
  for (const [k, label] of [
    ['career', 'Career'],
    ['sandbox', 'Sandbox career'],
  ] as const) {
    const b = btn(label, () => actions.switchKind(k));
    b.setAttribute('aria-pressed', String(actions.kind === k));
    tabs.append(b);
  }

  if (!save) {
    const sandbox = actions.kind === 'sandbox';
    const input = elt('input');
    input.type = 'text';
    input.maxLength = 40;
    input.value = 'Open Concept Designs Co.';
    input.setAttribute('aria-label', 'Firm name');
    const label = elt('label', '', 'Name your firm');
    label.append(input);
    const go = btn('Start career', () => actions.start(input.value), 'primary');
    const row = elt('div', 'dialog-actions');
    row.append(btn('Not now', actions.close), go);
    root.replaceChildren(
      tabs,
      elt('h2', '', sandbox ? 'Start a sandbox firm' : 'Start your design firm'),
      elt(
        'p',
        'muted',
        sandbox
          ? 'Skip the climb: you run a top-level firm with everything unlocked and a steady stream of clients. No objectives, but client budgets still apply.'
          : 'You’re a rookie designer with a laptop and big ideas. Take small jobs, keep clients happy, and grow into a firm that designs skyscrapers.',
      ),
      label,
      row,
    );
    return;
  }

  const tier = tierInfo(save.tier);
  const head = elt('div', 'office-head');
  const titles = elt('div');
  titles.append(elt('h2', '', save.firm), elt('div', 'muted', `Tier ${tier.tier} · ${tier.name}`));
  const money = elt('div', 'office-stats');
  money.append(elt('div', 'money', fmtMoney(save.money)), elt('div', 'muted small', `${save.xp} XP`));
  head.append(titles, money);

  const parts: HTMLElement[] = [tabs, head];

  if (payout) {
    const p = payout.payout;
    const banner = elt('div', 'payout');
    banner.append(
      elt('strong', '', `${payout.brief.title}: `),
      document.createTextNode(
        p.improved ? `+${fmtMoney(p.feePaid)} and +${p.xpGained} XP.` : 'No improvement on your best, so no extra fee this time.',
      ),
    );
    parts.push(banner);
    if (p.promotedTo) {
      const t = tierInfo(p.promotedTo);
      parts.push(elt('div', 'promo', `Promoted to Tier ${t.tier}: ${t.name}! Unlocked: ${t.unlocks}`));
    }
  }

  if (save.active) {
    const active = elt('div', 'active-job');
    active.append(elt('span', '', 'You have a job in progress.'), btn('Continue job', actions.continueJob, 'primary'));
    parts.push(active);
  }

  parts.push(elt('h3', '', 'Offer board'));
  const board = elt('div', 'offers');
  for (const b of offers(save)) {
    const rec = save.jobs[b.id];
    const card = elt('div', 'offer');
    const top = elt('div', 'offer-top');
    top.append(elt('strong', '', b.title), elt('span', 'stars-sm', rec ? starsText(rec.stars) : 'New'));
    card.append(
      top,
      elt('div', 'muted small', `${b.client} · ${b.clientRole}`),
      elt('p', 'small', b.summary),
      elt('div', 'small offer-terms', `Budget ${fmtMoney(b.budget)} · Fee up to ${fmtMoney(Math.round(b.fee * 1.5))} · ${THEME_NAMES[b.theme] ?? b.theme} style · ${fmtLen(b.lot.w)} × ${fmtLen(b.lot.h)} lot`),
    );
    const isActive = save.active?.briefId === b.id;
    card.append(
      btn(isActive ? 'Continue' : rec?.completions ? 'Redo for more stars' : 'Take job', () => (isActive ? actions.continueJob() : actions.takeJob(b)), 'wide-btn'),
    );
    board.append(card);
  }
  parts.push(board);

  const status = objectiveStatus(save);
  if (status.length) {
    const next = tierInfo(save.tier + 1);
    parts.push(elt('h3', '', `Next: Tier ${next.tier} · ${next.name}`));
    const list = elt('ul', 'checklist');
    for (const s of status) {
      const li = elt('li', s.met ? 'met' : 'unmet');
      const progress = s.objective.kind === 'jobs' ? `${s.progress}/${s.target}` : `best ${s.progress}`;
      li.append(elt('span', 'mark', s.met ? '✓' : '○'), elt('span', '', s.objective.text), elt('span', 'muted small', ` (${progress})`));
      list.append(li);
    }
    parts.push(list, elt('p', 'muted small', `Unlocks: ${next.unlocks}`));
  } else {
    if (save.id === 'sandbox') parts.push(elt('p', 'muted small', 'Sandbox: everything is unlocked and new clients rotate in as you finish jobs.'));
    else parts.push(
      elt('h3', '', 'More clients on the way'),
      elt('p', 'muted small', `Tier ${save.tier} jobs (${tier.unlocks.toLowerCase()}) are still on the drawing board. Replay jobs for three stars in the meantime.`),
    );
  }

  const row = elt('div', 'dialog-actions');
  row.append(btn('Reset career', actions.reset, 'danger'), btn('Close', actions.close));
  parts.push(row);
  root.replaceChildren(...parts);
}
