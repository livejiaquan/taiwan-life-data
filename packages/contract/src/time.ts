/**
 * Official Taiwan feeds publish timestamps in several shapes:
 *   2026-10-16T00:10:00+08:00  (CWA observations)
 *   2026-10-16T00:00:00+8:00   (CWA health weather — single-digit offset hour)
 *   2026/10/16 00:00:00        (MOENV, implicit Asia/Taipei)
 *   2026-10-16                 (CWA daily UV, implicit Asia/Taipei)
 * Returns epoch ms, or undefined when the value is not a real timestamp.
 */
export const parseOfficialTime = (value: unknown): number | undefined => {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  const match = /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?)?(?:\s*(Z|[+-]\d{1,2}(?::?\d{2})?))?$/.exec(text);
  if (!match) return undefined;
  const [, y, mo, d, h = "00", mi = "00", s = "00", zone] = match;
  let offset = "+08:00";
  if (zone === "Z") offset = "Z";
  else if (zone) {
    const z = /^([+-])(\d{1,2}):?(\d{2})?$/.exec(zone);
    if (!z) return undefined;
    offset = `${z[1]}${z[2]!.padStart(2, "0")}:${z[3] ?? "00"}`;
  }
  const ms = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`);
  return Number.isFinite(ms) ? ms : undefined;
};

export const toIso = (ms: number | undefined): string | null => (ms === undefined ? null : new Date(ms).toISOString());

/** Formats an instant as Taiwan wall-clock time, e.g. "10/16 08:20". */
export const formatTaipei = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
};
