import { describe, expect, it } from 'vitest';
import type { JobResult } from '../model/scoring';
import { canPromote, newCareer, objectiveStatus, offers, recordJob } from './career';

const job = (briefId: string, stars: 0 | 1 | 2 | 3, flow = 70, fee = 10000): JobResult => ({
  briefId,
  total: [30, 60, 75, 90][stars],
  stars,
  passed: stars > 0,
  parts: { flow, aesthetics: 70, budget: 80, brief: 90 },
  cost: 100000,
  issues: [],
  fee: stars > 0 ? fee : 0,
});

describe('career', () => {
  it('starts with the starter home, then the corner store, then the full board', () => {
    let save = newCareer('Test Studio');
    expect(offers(save).map((b) => b.id)).toEqual(['starter-home']);
    save = recordJob(save, job('starter-home', 2)).save;
    expect(offers(save).map((b) => b.id)).toEqual(['corner-store']);
    save = recordJob(save, job('corner-store', 1)).save;
    expect(offers(save).length).toBeGreaterThanOrEqual(3);
  });

  it('a failed job does not unlock the next one', () => {
    const save = recordJob(newCareer('x'), job('starter-home', 0)).save;
    expect(offers(save).map((b) => b.id)).toEqual(['starter-home']);
  });

  it('replays only pay the improvement', () => {
    let save = newCareer('x');
    const first = recordJob(save, job('starter-home', 1, 70, 10000));
    expect(first.feePaid).toBe(10000);
    expect(first.xpGained).toBe(150);
    save = first.save;
    const same = recordJob(save, job('starter-home', 1, 70, 10000));
    expect(same.feePaid).toBe(0);
    expect(same.xpGained).toBe(0);
    const better = recordJob(same.save, job('starter-home', 3, 70, 15000));
    expect(better.feePaid).toBe(5000);
    expect(better.xpGained).toBe(200);
  });

  it('promotes to tier 2 when the objectives are met', () => {
    let save = newCareer('x');
    save = recordJob(save, job('starter-home', 2)).save;
    save = recordJob(save, job('corner-store', 2, 70)).save;
    expect(canPromote(save)).toBe(false);
    save = recordJob(save, job('retiree-cottage', 2)).save;
    expect(objectiveStatus(save).map((s) => s.met)).toEqual([true, false]);
    const p = recordJob(save, job('night-mart', 2, 85));
    expect(p.promotedTo).toBe(2);
    expect(p.save.tier).toBe(2);
  });
});
