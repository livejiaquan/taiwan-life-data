export type JsonFetcher = (url: string) => Promise<unknown>;

/**
 * Error messages deliberately never include the URL: MOENV URLs carry an api_key.
 */
export const createJsonFetcher = (label: string, timeoutMs = 20_000, fetchImpl: typeof fetch = fetch): JsonFetcher =>
  async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: controller.signal });
      } catch {
        throw new Error(controller.signal.aborted ? `${label} 逾時` : `${label} 連線失敗`);
      }
      if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
      try {
        return await response.json();
      } catch {
        throw new Error(`${label} 回應不是有效 JSON`);
      }
    } finally {
      clearTimeout(timer);
    }
  };
