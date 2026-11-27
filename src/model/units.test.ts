import { afterEach, describe, expect, it } from 'vitest';
import { fmtArea, fmtAreaRound, fmtLen, fmtPerArea, fromDisplayLen, setUnits, toDisplayLen } from './units';
import { fmtMeters } from './grid';

describe('display units', () => {
  afterEach(() => setUnits('metric'));

  it('writes metric lengths and areas', () => {
    expect(fmtLen(3.5)).toBe('3.5 m');
    expect(fmtLen(4)).toBe('4 m');
    expect(fmtArea(12.25)).toBe('12.3 m²');
    expect(fmtPerArea(70)).toBe('70/m²');
    expect(fmtMeters(7)).toBe('3.5 m');
  });

  it('writes feet-and-inches and square feet', () => {
    setUnits('imperial');
    expect(fmtLen(3.5)).toBe('11′ 6″');
    expect(fmtLen(3.048)).toBe('10′');
    expect(fmtLen(20)).toBe('66 ft');
    expect(fmtArea(100)).toBe('1,076 sq ft');
    expect(fmtAreaRound(9)).toBe('97 sq ft');
    expect(fmtPerArea(70)).toBe('6.50/sq ft');
    expect(fmtMeters(7)).toBe('11′ 6″');
  });

  it('round-trips form lengths', () => {
    setUnits('imperial');
    expect(fromDisplayLen(toDisplayLen(20))).toBeCloseTo(20);
    expect(toDisplayLen(20)).toBeCloseTo(65.6, 1);
  });
});
