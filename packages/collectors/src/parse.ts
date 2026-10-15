/** Helpers for reading untyped official JSON (ported from taiwan-uv-heat-dashboard). */

export const toNumber = (value: unknown): number | undefined => {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const text = String(value).trim();
  // Number("") is 0, which would turn a blank field into a real reading.
  if (!text) return undefined;
  const parsed = Number(text);
  // CWA marks missing readings with sentinels such as -99 and -999.
  if (!Number.isFinite(parsed) || parsed <= -90) return undefined;
  return parsed;
};

export const boundedNumber = (value: unknown, min: number, max: number): number | undefined => {
  const number = toNumber(value);
  return number !== undefined && number >= min && number <= max ? number : undefined;
};

export const toText = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

export const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export const asArray = <T = unknown>(value: unknown): T[] => {
  if (Array.isArray(value)) return value as T[];
  if (value === undefined || value === null) return [];
  return [value as T];
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export class ValidationError extends Error {
  constructor(feed: string, problem: string) {
    super(`${feed}: ${problem}`);
    this.name = "ValidationError";
  }
}
