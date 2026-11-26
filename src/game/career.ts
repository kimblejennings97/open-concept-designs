/**
 * Career progression: a firm takes client jobs from an offer board, earns fees and XP,
 * and gets promoted through tiers by meeting objectives. Pure data + rules (no DOM).
 */
import { BRIEFS, type Brief, type BuildingType } from '../data/catalog';
import tiersData from '../data/tiers.json';
import type { JobResult } from '../model/scoring';

export type Objective =
  | { kind: 'jobs'; minStars: number; count: number; text: string }
  | { kind: 'flow'; building: BuildingType; min: number; text: string };

export interface Tier {
  tier: number;
  name: string;
  maxFloors: number;
  unlocks: string;
  objectives: Objective[];
}

export const TIERS: readonly Tier[] = tiersData.tiers as Tier[];
export const tierInfo = (t: number): Tier => TIERS.find((x) => x.tier === t) ?? TIERS[0];
export const MAX_TIER = Math.max(...TIERS.map((t) => t.tier));

export interface JobRecord {
  stars: number;
  total: number;
  /** Best fee paid so far for this job (replays only pay the improvement). */
  fee: number;
  flow: number;
  completions: number;
}

export interface CareerSave {
  id: 'career';
  version: 1;
  firm: string;
  tier: number;
  money: number;
  xp: number;
  jobs: Record<string, JobRecord>;
  /** The job being worked on, if any. */
  active?: { briefId: string; designId: string };
  startedAt: number;
}

export function newCareer(firm: string): CareerSave {
  return { id: 'career', version: 1, firm: firm.trim() || 'My Design Studio', tier: 1, money: 5000, xp: 0, jobs: {}, startedAt: Date.now() };
}

/** Story order for the first jobs: the starter home, then the corner store, then the rest of the tier. */
const FIRST_JOBS = ['starter-home', 'corner-store'];

/** Offers on the board right now (2–4). */
export function offers(save: CareerSave): Brief[] {
  const pending = FIRST_JOBS.find((id) => !save.jobs[id]?.completions);
  if (pending) {
    const brief = BRIEFS.find((b) => b.id === pending);
    return brief ? [brief] : [];
  }
  const available = BRIEFS.filter((b) => b.tier <= save.tier);
  // Unfinished or improvable jobs first, then by tier (newest first).
  return [...available]
    .sort((a, b) => (save.jobs[a.id]?.stars ?? 0) - (save.jobs[b.id]?.stars ?? 0) || b.tier - a.tier)
    .slice(0, 4);
}

export interface ObjectiveStatus {
  objective: Objective;
  progress: number;
  target: number;
  met: boolean;
}

export function objectiveStatus(save: CareerSave): ObjectiveStatus[] {
  return tierInfo(save.tier).objectives.map((o) => {
    if (o.kind === 'jobs') {
      const progress = Object.values(save.jobs).filter((j) => j.stars >= o.minStars).length;
      return { objective: o, progress: Math.min(progress, o.count), target: o.count, met: progress >= o.count };
    }
    const best = Math.max(
      0,
      ...BRIEFS.filter((b) => b.building === o.building).map((b) => save.jobs[b.id]?.flow ?? 0),
    );
    return { objective: o, progress: best, target: o.min, met: best >= o.min };
  });
}

/** Promoted when every objective of the current tier is met (tiers without objectives are the end of content). */
export function canPromote(save: CareerSave): boolean {
  const status = objectiveStatus(save);
  return save.tier < MAX_TIER && status.length > 0 && status.every((s) => s.met);
}

export const XP_PER_STAR = 100;

export interface Payout {
  save: CareerSave;
  feePaid: number;
  xpGained: number;
  promotedTo: number | null;
  improved: boolean;
}

/** Bank a submitted job. Replays only pay the fee and XP improvement over your best. */
export function recordJob(prev: CareerSave, result: JobResult): Payout {
  const save: CareerSave = { ...prev, jobs: { ...prev.jobs } };
  const old = save.jobs[result.briefId];
  const feePaid = Math.max(0, result.fee - (old?.fee ?? 0));
  const xpGained = Math.max(0, result.stars - (old?.stars ?? 0)) * XP_PER_STAR + (result.passed && !old?.completions ? 50 : 0);
  save.jobs[result.briefId] = {
    stars: Math.max(result.stars, old?.stars ?? 0),
    total: Math.max(result.total, old?.total ?? 0),
    fee: Math.max(result.fee, old?.fee ?? 0),
    flow: Math.max(result.parts.flow, old?.flow ?? 0),
    completions: (old?.completions ?? 0) + (result.passed ? 1 : 0),
  };
  save.money += feePaid;
  save.xp += xpGained;
  let promotedTo: number | null = null;
  if (canPromote(save)) {
    save.tier += 1;
    promotedTo = save.tier;
  }
  return { save, feePaid, xpGained, promotedTo, improved: feePaid > 0 || xpGained > 0 };
}
