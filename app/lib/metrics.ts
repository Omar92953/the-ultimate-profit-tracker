/** Small helpers shared by server code and pages (no server imports here). */
export const COHORT_WINDOWS = [30, 60, 90, 180, 365] as const;

export function pctChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
