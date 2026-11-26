import { describe, expect, it } from 'vitest';
import { getBrief } from '../data/catalog';
import { evaluateJob } from '../game/evaluate';
import { createDesign } from './design';
import { findRooms } from './rooms';
import { sampleHouse, sampleStore } from './samples';
import { checkBrief, colorHarmony, combineScores, scoreAesthetics, scoreBudget, starsFor } from './scoring';

describe('colorHarmony', () => {
  it('likes neutrals and close hues, dislikes awkward pairs', () => {
    expect(colorHarmony('#f2efe8', '#c98f8f')).toBe(1); // white with anything
    expect(colorHarmony('#b07a45', '#9c4f3c')).toBe(1); // wood + brick, close hues
    expect(colorHarmony('#5f9e5a', '#2f4468')).toBeLessThan(1); // green + navy
  });
});

describe('scoreBudget', () => {
  it('rewards savings and blocks big overruns', () => {
    expect(scoreBudget(100, 100).score).toBe(80);
    expect(scoreBudget(80, 100).score).toBe(100);
    const over = scoreBudget(105, 100);
    expect(over.canSubmit).toBe(true);
    expect(over.score).toBeLessThan(70);
    expect(scoreBudget(120, 100).canSubmit).toBe(false);
  });
});

describe('scoreAesthetics', () => {
  it('scores a finished sample above an empty lot', () => {
    const empty = createDesign();
    expect(scoreAesthetics(empty, findRooms(empty)).score).toBe(0);
    const d = sampleHouse();
    const a = scoreAesthetics(d, findRooms(d));
    expect(a.score).toBeGreaterThan(40);
    expect(a.light).toBeGreaterThan(0.5);
  });
});

describe('briefs', () => {
  it('checks requirements against the sample house', () => {
    const d = sampleHouse();
    const checks = checkBrief(d, findRooms(d), getBrief('starter-home')!);
    const label = (s: string) => checks.find((c) => c.label.includes(s))!;
    expect(label('bathroom').met).toBe(true);
    expect(label('sofa').met).toBe(true);
    expect(label('bedroom').met).toBe(true); // both bedrooms are 9 m²+
  });

  it('turns totals into stars', () => {
    expect([starsFor(90), starsFor(75), starsFor(55), starsFor(30)]).toEqual([3, 2, 1, 0]);
    const brief = getBrief('starter-home')!;
    const r = combineScores(brief, { flow: 90, aesthetics: 90, budget: 90, brief: 90 }, 1000, []);
    expect(r.stars).toBe(3);
    expect(r.fee).toBe(Math.round(brief.fee * 1.5));
    const fail = combineScores(brief, { flow: 90, aesthetics: 90, budget: 90, brief: 30 }, 1000, []);
    expect(fail.passed).toBe(false);
    expect(fail.fee).toBe(0);
  });

  it('evaluates the store sample end to end', () => {
    const d = sampleStore();
    const ev = evaluateJob(d, findRooms(d), getBrief('corner-store')!);
    expect(ev.result.total).toBeGreaterThan(0);
    expect(ev.result.total).toBeLessThanOrEqual(100);
    expect(ev.flow.people).toBe(24);
  });
});
