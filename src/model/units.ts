/**
 * Display units. The model always works in meters; this only changes how lengths and areas
 * are written for the player (meters and m², or feet-and-inches and square feet).
 */
export type Units = 'metric' | 'imperial';

const FT_PER_M = 3.28084;
const SQFT_PER_M2 = 10.7639;

let current: Units = 'metric';

export const getUnits = (): Units => current;
export function setUnits(u: Units): void {
  current = u;
}

const trim = (n: number, digits = 1): string => (Number.isInteger(n) ? n.toFixed(0) : n.toFixed(digits));
const group = (n: number): string => Math.round(n).toLocaleString('en-US');

/** A length, e.g. "3.5 m" or "11′ 6″". Long runs (30 ft+) drop the inches: "48 ft". */
export function fmtLen(m: number, u: Units = current): string {
  if (u === 'metric') return `${trim(Math.round(m * 10) / 10)} m`;
  const totalIn = Math.round(m * FT_PER_M * 12);
  const ft = Math.floor(totalIn / 12);
  const inch = totalIn % 12;
  if (ft >= 30) return `${group(m * FT_PER_M)} ft`;
  return inch ? `${ft}′ ${inch}″` : `${ft}′`;
}

/** An area, e.g. "12.5 m²" or "135 sq ft". */
export function fmtArea(m2: number, u: Units = current): string {
  return u === 'metric' ? `${m2.toFixed(1)} m²` : `${group(m2 * SQFT_PER_M2)} sq ft`;
}

/** A whole-number area for brief targets, e.g. "60 m²" or "646 sq ft". */
export function fmtAreaRound(m2: number, u: Units = current): string {
  return u === 'metric' ? `${Math.round(m2)} m²` : `${group(m2 * SQFT_PER_M2)} sq ft`;
}

/** A price per area, e.g. "70/m²" or "6.50/sq ft". */
export function fmtPerArea(perM2: number, u: Units = current): string {
  if (u === 'metric') return `${perM2}/m²`;
  const v = perM2 / SQFT_PER_M2;
  return `${v < 10 ? v.toFixed(2) : Math.round(v)}/sq ft`;
}

/** Lengths for form fields: meters ↔ the current unit. */
export const toDisplayLen = (m: number, u: Units = current): number => (u === 'metric' ? m : m * FT_PER_M);
export const fromDisplayLen = (v: number, u: Units = current): number => (u === 'metric' ? v : v / FT_PER_M);
export const lenUnitLabel = (u: Units = current): string => (u === 'metric' ? 'm' : 'ft');
