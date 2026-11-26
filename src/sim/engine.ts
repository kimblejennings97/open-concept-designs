/**
 * Time-stepped crowd simulation on a NavGrid. Generic: agents get a start cell, a start
 * time and a list of goals (each a set of candidate cells, a dwell time and a label).
 *
 * Movement: agents walk cell to cell along A* paths. A cell holds one agent; if the next
 * cell is taken the agent waits (that's congestion). Two agents swapping head-on pass
 * each other, and an agent blocked for `giveWayAfter` seconds squeezes past, except when
 * the blocker is busy at its goal (that's a queue, e.g. for a bathroom or a checkout).
 */
import { findPath } from './astar';
import type { NavGrid } from './navgrid';

export interface Goal {
  /** Candidate cells. The agent picks the one with the best (distance + crowding) when it sets off. */
  cells: number[];
  /** Seconds spent at the goal once there. */
  dwell: number;
  /** For reports, e.g. "bathroom". */
  label: string;
}

export interface AgentSpec {
  kind: string;
  start: number;
  startTime: number;
  goals: Goal[];
}

export interface SimConfig {
  dt: number;
  maxTime: number;
  /** Walking speed in cells per second. */
  speed: number;
  giveWayAfter: number;
}

export const DEFAULT_SIM_CONFIG: SimConfig = { dt: 0.2, maxTime: 900, speed: 2.6, giveWayAfter: 3 };

export const PHASE_INACTIVE = 0;
export const PHASE_WALK = 1;
export const PHASE_BLOCKED = 2;
export const PHASE_DWELL = 3;

export interface AgentOutcome {
  kind: string;
  finished: boolean;
  startTime: number;
  endTime: number;
  /** Time the trip would take with nobody else around. */
  idealTime: number;
  /** Seconds spent blocked by other people. */
  waitTime: number;
  /** Distance walked, in cells. */
  walked: number;
  /** Labels of goals this agent couldn't reach. */
  unreachable: string[];
}

export interface SimResult {
  outcomes: AgentOutcome[];
  /** Agent-seconds spent in each cell. */
  heat: Float32Array;
  /** Seconds agents spent blocked in each cell. */
  waitHeat: Float32Array;
  /** Blocked seconds, by the label of the goal the agent was heading to. */
  waitByLabel: Record<string, number>;
  /** Per frame, per agent: x, y in cell units (cell centers at +0.5). NaN when not on the grid. */
  frames: Float32Array;
  /** Per frame, per agent: PHASE_*. */
  phases: Uint8Array;
  frameCount: number;
  agentCount: number;
  dt: number;
  duration: number;
}

interface Agent {
  spec: AgentSpec;
  out: AgentOutcome;
  started: boolean;
  done: boolean;
  cell: number;
  next: number;
  stepCost: number;
  progress: number;
  path: number[];
  goalIdx: number;
  target: number;
  phase: number;
  dwellLeft: number;
  blockedFor: number;
}

export function runSim(grid: NavGrid, specs: AgentSpec[], cfg: SimConfig = DEFAULT_SIM_CONFIG): SimResult {
  const n = grid.w * grid.h;
  const occ = new Uint16Array(n);
  const occId = new Int32Array(n).fill(-1);
  const targeting = new Uint16Array(n);
  const heat = new Float32Array(n);
  const waitHeat = new Float32Array(n);
  const waitByLabel: Record<string, number> = {};
  const frames: number[] = [];
  const phases: number[] = [];

  const agents: Agent[] = specs.map((spec) => ({
    spec,
    out: {
      kind: spec.kind,
      finished: false,
      startTime: spec.startTime,
      endTime: cfg.maxTime,
      idealTime: 0,
      waitTime: 0,
      walked: 0,
      unreachable: [],
    },
    started: false,
    done: false,
    cell: spec.start,
    next: -1,
    stepCost: 1,
    progress: 0,
    path: [],
    goalIdx: -1,
    target: -1,
    phase: PHASE_INACTIVE,
    dwellLeft: 0,
    blockedFor: 0,
  }));

  const occupy = (c: number, id: number) => {
    occ[c]++;
    occId[c] = id;
  };
  const release = (c: number) => {
    occ[c]--;
    if (occ[c] > 0) occId[c] = agents.findIndex((a) => !a.done && a.started && (a.cell === c || a.next === c));
    else occId[c] = -1;
  };

  let t = 0;
  const finish = (a: Agent) => {
    a.done = true;
    a.phase = PHASE_INACTIVE;
    a.out.finished = a.out.unreachable.length === 0;
    a.out.endTime = t;
    release(a.cell);
  };

  /** Head for goal i (or the next reachable one); finishes the agent after the last. */
  const setGoal = (a: Agent, i: number) => {
    const goals = a.spec.goals;
    for (; i < goals.length; i++) {
      const goal = goals[i];
      let best: { cell: number; cells: number[]; cost: number; score: number } | null = null;
      for (const c of goal.cells) {
        const p = findPath(grid, a.cell, c);
        if (!p) continue;
        const score = p.cost + 8 * targeting[c];
        if (!best || score < best.score) best = { cell: c, cells: p.cells, cost: p.cost, score };
      }
      if (!best) {
        a.out.unreachable.push(goal.label);
        continue;
      }
      a.goalIdx = i;
      a.target = best.cell;
      targeting[best.cell]++;
      a.path = best.cells.slice(1);
      a.out.idealTime += best.cost / cfg.speed + goal.dwell;
      a.phase = PHASE_WALK;
      return;
    }
    finish(a);
  };

  const advance = (a: Agent) => {
    if (a.target >= 0) targeting[a.target]--;
    a.target = -1;
    setGoal(a, a.goalIdx + 1);
  };

  const canEnter = (a: Agent, c: number) => {
    if (occ[c] === 0) return true;
    const b = agents[occId[c]];
    if (!b) return true;
    if (b.phase === PHASE_DWELL) return false; // a queue: wait your turn
    if (b.next === -1 && b.path[0] === a.cell) return true; // head-on: swap
    return a.blockedFor >= cfg.giveWayAfter;
  };

  const lastStart = specs.reduce((m, s) => Math.max(m, s.startTime), 0);
  let tick = 0;
  for (; t < cfg.maxTime; t += cfg.dt, tick++) {
    const forward = tick % 2 === 0;
    for (let k = 0; k < agents.length; k++) {
      const id = forward ? k : agents.length - 1 - k;
      const a = agents[id];
      if (a.done) continue;

      if (!a.started) {
        if (t < a.spec.startTime) continue;
        if (occ[a.spec.start] > 0) {
          a.out.waitTime += cfg.dt;
          continue;
        }
        a.started = true;
        a.out.startTime = t;
        occupy(a.cell, id);
        setGoal(a, 0);
        if (a.done) continue;
      }

      if (a.phase === PHASE_DWELL) {
        a.dwellLeft -= cfg.dt;
        if (a.dwellLeft <= 0) advance(a);
      } else if (a.next === -1) {
        if (a.path.length === 0) {
          const dwell = a.spec.goals[a.goalIdx].dwell;
          if (dwell > 0) {
            a.phase = PHASE_DWELL;
            a.dwellLeft = dwell;
          } else {
            advance(a);
          }
        } else {
          const c = a.path[0];
          if (canEnter(a, c)) {
            occupy(c, id);
            a.next = c;
            a.path.shift();
            a.progress = 0;
            a.blockedFor = 0;
            const diag = c % grid.w !== a.cell % grid.w && Math.floor(c / grid.w) !== Math.floor(a.cell / grid.w);
            a.stepCost = diag ? Math.SQRT2 : 1;
            a.phase = PHASE_WALK;
          } else {
            a.blockedFor += cfg.dt;
            a.out.waitTime += cfg.dt;
            waitHeat[a.cell] += cfg.dt;
            const label = a.spec.goals[a.goalIdx].label;
            waitByLabel[label] = (waitByLabel[label] ?? 0) + cfg.dt;
            a.phase = PHASE_BLOCKED;
          }
        }
      }

      if (!a.done && a.next !== -1) {
        a.progress += (cfg.speed * cfg.dt) / a.stepCost;
        if (a.progress >= 1) {
          release(a.cell);
          a.out.walked += a.stepCost;
          a.cell = a.next;
          a.next = -1;
          a.progress = 0;
        }
      }
      if (!a.done) heat[a.cell] += cfg.dt;
    }

    // Record a frame.
    for (const a of agents) {
      if (!a.started || a.done) {
        frames.push(NaN, NaN);
        phases.push(PHASE_INACTIVE);
        continue;
      }
      const cx = (a.cell % grid.w) + 0.5;
      const cy = Math.floor(a.cell / grid.w) + 0.5;
      if (a.next === -1) {
        frames.push(cx, cy);
      } else {
        const nx = (a.next % grid.w) + 0.5;
        const ny = Math.floor(a.next / grid.w) + 0.5;
        frames.push(cx + (nx - cx) * a.progress, cy + (ny - cy) * a.progress);
      }
      phases.push(a.phase);
    }

    if (t >= lastStart && agents.every((a) => a.done)) {
      t += cfg.dt;
      tick++;
      break;
    }
  }

  return {
    outcomes: agents.map((a) => a.out),
    heat,
    waitHeat,
    waitByLabel,
    frames: Float32Array.from(frames),
    phases: Uint8Array.from(phases),
    frameCount: tick,
    agentCount: agents.length,
    dt: cfg.dt,
    duration: t,
  };
}
