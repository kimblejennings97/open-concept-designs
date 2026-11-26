/** Grades a design against its client brief: runs the flow sim and combines every score. */
import type { Brief } from '../data/catalog';
import { computeCost } from '../model/cost';
import type { Design } from '../model/design';
import type { RoomMap } from '../model/rooms';
import {
  type AestheticsBreakdown,
  type BriefCheck,
  type JobResult,
  type ScoreIssue,
  combineScores,
  scoreAesthetics,
  scoreBrief,
  scoreBudget,
} from '../model/scoring';
import { type FlowReport, simulateFlow } from '../sim/scenarios';

export interface Evaluation {
  result: JobResult;
  flow: FlowReport;
  aesthetics: AestheticsBreakdown;
  checks: BriefCheck[];
  canSubmit: boolean;
}

export function evaluateJob(d: Design, rooms: RoomMap, brief: Brief): Evaluation {
  const cost = computeCost(d, rooms.rooms).total;
  const flow = simulateFlow(d, rooms, brief.building);
  const aesthetics = scoreAesthetics(d, rooms, brief.theme);
  const briefScore = scoreBrief(d, rooms, brief);
  const budget = scoreBudget(cost, brief.budget);
  const flowIssues: ScoreIssue[] = flow.issues.map((i) => ({ category: 'flow', text: i.text, severity: i.severity }));
  const result = combineScores(
    brief,
    { flow: flow.score, aesthetics: aesthetics.score, budget: budget.score, brief: briefScore.score },
    cost,
    [...flowIssues, ...aesthetics.issues, ...budget.issues, ...briefScore.issues],
  );
  return { result, flow, aesthetics, checks: briefScore.checks, canSubmit: budget.canSubmit };
}
