/**
 * 綠電時段: which hours of the day the grid is usually cleanest.
 * Built from intensity samples (our archive, or Taipower's quarterly 10-minute history);
 * it describes the past, not a forecast (docs/METHODOLOGY-carbon.md).
 */

export interface IntensityPoint {
  at: number;
  /** Lifecycle gCO2eq/kWh. */
  lifecycle: number;
}

export interface HourStat {
  /** Taipei hour of day, 0–23. */
  hour: number;
  n: number;
  /** Mean lifecycle intensity of samples in this hour, or null when there are none. */
  lifecycle: number | null;
}

export interface HourWindow {
  /** Taipei hour the window starts (inclusive) and ends (exclusive, may wrap past 24 → 0). */
  startHour: number;
  endHour: number;
  lifecycle: number;
}

export interface PowerProfile {
  schemaVersion: 1;
  /** Built from our own archive (docs/DECISIONS.md D20 explains why not from Taipower's history file). */
  kind: "recent";
  generatedAt: string;
  basis: string;
  from: string | null;
  to: string | null;
  samples: number;
  hours: HourStat[];
  greenest: HourWindow | null;
  dirtiest: HourWindow | null;
  /** Why no windows were derived (too few samples or hours), else null. */
  insufficient: string | null;
}

export const PROFILE_RULES = { minSamples: 48, minHours: 18, windowHours: 3 };

const taipeiHour = (ms: number) => new Date(ms + 8 * 3_600_000).getUTCHours();

export const computeProfile = (
  points: IntensityPoint[],
  meta: { kind: PowerProfile["kind"]; basis: string; generatedAt: string },
  rules = PROFILE_RULES,
): PowerProfile => {
  const sums = Array.from({ length: 24 }, () => ({ n: 0, total: 0 }));
  for (const p of points) {
    const slot = sums[taipeiHour(p.at)]!;
    slot.n += 1;
    slot.total += p.lifecycle;
  }
  const hours: HourStat[] = sums.map((s, hour) => ({ hour, n: s.n, lifecycle: s.n ? Math.round(s.total / s.n) : null }));
  const covered = hours.filter((h) => h.n > 0).length;
  const times = points.map((p) => p.at).sort((a, b) => a - b);
  const base = {
    schemaVersion: 1 as const,
    ...meta,
    from: times.length ? new Date(times[0]!).toISOString() : null,
    to: times.length ? new Date(times.at(-1)!).toISOString() : null,
    samples: points.length,
    hours,
  };
  const insufficient =
    points.length < rules.minSamples
      ? `樣本 ${points.length} 筆，少於 ${rules.minSamples} 筆`
      : covered < rules.minHours
        ? `只有 ${covered} 個小時有樣本，少於 ${rules.minHours} 個`
        : null;
  if (insufficient) return { ...base, greenest: null, dirtiest: null, insufficient };

  // Every window must have a sample in each of its hours; wrap past midnight.
  const windows: HourWindow[] = [];
  for (let start = 0; start < 24; start += 1) {
    const span = Array.from({ length: rules.windowHours }, (_, i) => hours[(start + i) % 24]!);
    if (span.some((h) => h.lifecycle === null)) continue;
    windows.push({ startHour: start, endHour: (start + rules.windowHours) % 24, lifecycle: Math.round(span.reduce((s, h) => s + h.lifecycle!, 0) / span.length) });
  }
  if (!windows.length) return { ...base, greenest: null, dirtiest: null, insufficient: "沒有連續的小時樣本" };
  const sorted = [...windows].sort((a, b) => a.lifecycle - b.lifecycle || a.startHour - b.startHour);
  return { ...base, greenest: sorted[0]!, dirtiest: sorted.at(-1)!, insufficient: null };
};

export const isPowerProfile = (value: unknown): value is PowerProfile =>
  typeof value === "object" && value !== null && (value as PowerProfile).schemaVersion === 1 && Array.isArray((value as PowerProfile).hours) && (value as PowerProfile).hours.length === 24;
