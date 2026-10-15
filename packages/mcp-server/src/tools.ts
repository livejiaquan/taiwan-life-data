import { assessCard, assessPower, CATEGORY_LABEL, FAIL_CLOSED, ORDER, REGION_LABEL, reservoirRows, SHORT_LABEL, summarize, usableProfile, windowText, type Tone, type Verdict } from "@taiwan-life-data/assess";
import { isArchiveDay, rainDatasetId, type PowerData } from "@taiwan-life-data/collectors";
import {
  COUNTIES,
  computeStatus,
  currentStatus,
  dataAgeMinutes,
  FEEDS,
  findTown,
  formatDuration,
  formatTaipei,
  INCIDENT_KIND_TEXT,
  incidentLabel,
  normalizeCountyName,
  openCollectGap,
  sortIncidents,
  TOWNS,
  townsOf,
  type FeedEnvelope,
  type FeedId,
  type FeedStatus,
  type Town,
} from "@taiwan-life-data/contract";
import type { DataSource, FeedRead } from "./data";

export const STATUS_TEXT: Record<FeedStatus, string> = { live: "即時", delayed: "延遲", stale: "過舊", unavailable: "無法取得" };
const TONE_TEXT: Record<Tone, string> = { ok: "正常", notice: "留意", warn: "注意", danger: "危險", unknown: "無法判斷" };
const FEED_IDS = Object.keys(FEEDS) as FeedId[];

/** Thrown for bad input; the server turns it into an isError result the model can act on. */
export class InputError extends Error {}

const strip = (name: string) => name.replace(/[區鄉鎮市]$/, "");

/**
 * Accepts 台/臺, and a township with or without its 區/鄉/鎮/市 suffix. The county
 * may be omitted when the township name is unique in Taiwan.
 */
export const resolveTown = (countyInput: string | undefined, townInput: string): Town => {
  const townName = townInput.trim();
  if (countyInput?.trim()) {
    const county = normalizeCountyName(countyInput);
    if (!county) throw new InputError(`找不到縣市「${countyInput}」。可用：${COUNTIES.map((c) => c.name).join("、")}`);
    const exact = findTown(county, townName);
    if (exact) return exact;
    const loose = townsOf(county).filter((t) => strip(t.town) === strip(townName));
    if (loose.length === 1) return loose[0]!;
    throw new InputError(`${county}沒有「${townName}」。${county}的鄉鎮市區：${townsOf(county).map((t) => t.town).join("、")}`);
  }
  const matches = TOWNS.filter((t) => t.town === townName || strip(t.town) === strip(townName));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) throw new InputError(`「${townName}」不只一個，請指定縣市：${matches.map((t) => `${t.county}${t.town}`).join("、")}`);
  throw new InputError(`找不到鄉鎮市區「${townName}」。可先用 list_towns 查詢。`);
};

/** A read can cross a freshness threshold while other reads are still pending: grade again at the time of the answer. */
const regrade = <K extends FeedId>(read: FeedRead<K>, now: number): FeedRead<K> => ({ ...read, status: read.envelope ? currentStatus(read.envelope, now) : "unavailable" });

const dataTime = (feed: FeedId, envelope: FeedEnvelope<unknown>) => (FEEDS[feed].freshness.basis === "retrievedAt" ? envelope.retrievedAt : envelope.sourceTime);

const provenance = (feed: FeedId, read: FeedRead<FeedId>, now: number, town?: Town): string => {
  const env = read.envelope;
  const datasetId = (feed === "rain" && town && rainDatasetId(town.county)) || FEEDS[feed].source.datasetId;
  const source = `${FEEDS[feed].source.agency} ${datasetId}`;
  if (!env) return `來源：${source}`;
  const age = dataAgeMinutes(FEEDS[feed].freshness, env, now);
  const via = read.via === "official" ? "直接讀官方資料" : "本站快照";
  return `資料時間 ${formatTaipei(dataTime(feed, env))}・資料年齡 ${age === null ? "未知" : formatDuration(age)}・${via}・來源：${source}`;
};

const header = (title: string, now: number) => `# ${title}\n查詢時間 ${formatTaipei(new Date(now).toISOString())}（台北時間）`;

// Quiet verdicts (e.g. AQI 普通) are coloured on the website but not called out in the summary.
const verdictLines = (v: Verdict) => [`${v.headline}${v.quiet ? "" : `（${TONE_TEXT[v.tone]}）`}`, ...v.details.map((d) => `- ${d}`)];

export const outdoorBrief = async (src: DataSource, county: string | undefined, town: string): Promise<string> => {
  const place = resolveTown(county, town);
  const reads = await Promise.all(ORDER.map((feed) => src.feed(feed, place)));
  const now = src.now();
  const items = ORDER.map((feed, i) => {
    const read = regrade(reads[i]!, now);
    const verdict = read.envelope && (read.status === "live" || read.status === "delayed") ? assessCard(feed, read.envelope.data, place, now) : null;
    return { feed, read, verdict };
  });
  const summary = summarize(items.map((i) => ({ label: SHORT_LABEL[i.feed], verdict: i.verdict, pending: false })));
  const url = new URL(src.siteUrl);
  url.searchParams.set("county", place.county);
  url.searchParams.set("town", place.town);
  const out = [header(`出門前：${place.county}${place.town}`, now), `總結：${summary.text}`, ""];
  for (const { feed, read, verdict } of items) {
    out.push(`## ${FEEDS[feed].label}【${STATUS_TEXT[read.status]}】`);
    if (verdict) out.push(...verdictLines(verdict));
    else out.push(FAIL_CLOSED[read.status === "stale" ? "stale" : "unavailable"](feed));
    if (read.status === "delayed") out.push("- 注意：資料已延遲，僅供參考");
    out.push(provenance(feed, read as FeedRead<FeedId>, now, place), "");
  }
  out.push(
    "判定規則：每項依資料年齡重新判定即時／延遲／過舊；過舊或無法取得時不下結論（fail-closed）。警特報以縣市發布；紫外線與空品取同縣市最近測站，不跨縣市借用。",
    `網頁版：${url.toString()}`,
  );
  return out.join("\n");
};

export const listTowns = (county: string | undefined): string => {
  if (!county?.trim()) return [`全台 ${COUNTIES.length} 個縣市、${TOWNS.length} 個鄉鎮市區。指定 county 可列出該縣市的鄉鎮市區。`, ...COUNTIES.map((c) => `- ${c.name}（${townsOf(c.name).length}）`)].join("\n");
  const name = normalizeCountyName(county);
  if (!name) throw new InputError(`找不到縣市「${county}」。可用：${COUNTIES.map((c) => c.name).join("、")}`);
  return [`${name}共 ${townsOf(name).length} 個鄉鎮市區：`, townsOf(name).map((t) => t.town).join("、")].join("\n");
};

export const gridCarbon = async (src: DataSource): Promise<string> => {
  const [raw, profile] = await Promise.all([src.feed("power"), src.powerProfile()]);
  const now = src.now();
  const read = regrade(raw, now);
  const out = [header("台灣電網碳強度", now), ""];
  const data = read.envelope?.data as PowerData | undefined;
  out.push(`狀態：${STATUS_TEXT[read.status]}`);
  // Too old to call "current": same 90-minute cutoff as the website.
  if (!data || (read.status !== "live" && read.status !== "delayed")) out.push(read.status === "stale" ? "資料過舊，不顯示目前碳強度。" : "目前無法取得台電資料。");
  else {
    out.push(...verdictLines(assessPower(data, profile, now)));
    const total = data.categories.filter((c) => c.mw > 0 && c.category !== "storage").reduce((s, c) => s + c.mw, 0);
    const mix = [...data.categories].filter((c) => c.mw > 0).sort((a, b) => b.mw - a.mw);
    out.push("", "能源別（淨發電 MW，占比以主要發電計）：", ...mix.map((c) => `- ${CATEGORY_LABEL[c.category] ?? c.category} ${Math.round(c.mw).toLocaleString("en-US")} MW${c.category !== "storage" && total ? `（${((c.mw / total) * 100).toFixed(1)}%）` : ""}`));
    out.push(`再生能源占 ${data.renewablePercent}%；係數版本 ${data.factorsVersion}`);
  }
  const fair = usableProfile(profile, now);
  out.push("", "綠電時段（本站最近 14 天存檔中平均碳強度最低的連續 3 小時）：");
  if (fair?.greenest) out.push(`- 最低：${windowText(fair.greenest)}（平均 ${fair.greenest.lifecycle} 公克／度）${fair.dirtiest ? `；最高：${windowText(fair.dirtiest)}（${fair.dirtiest.lifecycle}）` : ""}；樣本 ${fair.samples} 筆`);
  else out.push(`- 尚不推估：${profile?.insufficient ?? (profile ? "最新樣本超過 3 天" : "讀不到 power-profile.json")}`);
  if (read.envelope) out.push("", provenance("power", read as FeedRead<FeedId>, now));
  out.push("方法與係數出處：https://github.com/livejiaquan/taiwan-life-data/blob/main/docs/METHODOLOGY-carbon.md");
  return out.join("\n");
};

export const reservoirs = async (src: DataSource, query: string | undefined): Promise<string> => {
  const raw = await src.feed("reservoir");
  const now = src.now();
  const read = regrade(raw, now);
  const out = [header("主要水庫蓄水", now), `狀態：${STATUS_TEXT[read.status]}`];
  const data = read.envelope?.data;
  if (!data || (read.status !== "live" && read.status !== "delayed")) {
    out.push(read.status === "stale" ? "資料過舊，不顯示蓄水率。" : "目前無法取得水利署資料。");
    return out.join("\n");
  }
  const q = query?.trim();
  const rows = reservoirRows(data, now);
  for (const region of ["north", "central", "south"] as const) {
    const list = rows[region].filter((r) => !q || r.name.includes(q) || r.county.includes(q.replace(/^台/, "臺")) || REGION_LABEL[region].includes(q));
    if (!list.length) continue;
    out.push("", `## ${REGION_LABEL[region]}`);
    // Per-reservoir fail-closed, as on the website.
    for (const r of list) out.push(r.fresh ? `- ${r.name}（${r.county}）${r.percent}%・有效蓄水 ${r.storage.toLocaleString("en-US")} 萬立方公尺・${formatTaipei(r.observedAt)}` : `- ${r.name}（${r.county}）資料過舊（${formatTaipei(r.observedAt)}），不顯示`);
  }
  if (out.length <= 2) out.push(`沒有符合「${q}」的水庫。`);
  out.push("", provenance("reservoir", read as FeedRead<FeedId>, now));
  return out.join("\n");
};

export const dataStatus = async (src: DataSource): Promise<string> => {
  const doc = await src.statusDoc();
  const now = src.now();
  const out = [header("資料狀態與事故紀錄", now), ""];
  if (!doc) return [...out, "讀不到 data/status.json。"].join("\n");
  out.push("## 各資料來源（最近一次收集）");
  for (const feed of FEED_IDS) {
    const h = doc.feeds[feed];
    if (!h) continue;
    // Re-grade by age now: status.json is only as fresh as the last collect run.
    const times = { sourceTime: h.sourceTime, retrievedAt: h.lastSuccessAt ?? h.lastAttemptAt };
    const graded = computeStatus(FEEDS[feed].freshness, times, h.status !== "unavailable", now);
    const age = dataAgeMinutes(FEEDS[feed].freshness, times, now);
    out.push(`- ${FEEDS[feed].label}：快照現在${STATUS_TEXT[graded]}（資料年齡約 ${age === null ? "未知" : formatDuration(age)}）；最近成功收集 ${formatTaipei(h.lastSuccessAt)}${h.lastAttemptOk ? "" : `；最近一次失敗：${h.lastError ?? ""}`}`);
  }
  const last = doc.runs.at(-1)?.at;
  out.push("", `收集紀錄 ${doc.runs.length} 次，最近一次 ${formatTaipei(last)}${last ? `（${formatDuration(Math.round((now - Date.parse(last)) / 60_000))}前）` : ""}。`);
  out.push("網頁對氣象署與水利署資料會在快照不新時直接讀官方檔；空品與台電只能等收集。");
  const gap = openCollectGap(doc, now);
  const incidents = sortIncidents(gap ? [gap, ...doc.incidents] : doc.incidents);
  const open = incidents.filter((i) => i.endedAt === null);
  out.push("", `## 事故（進行中 ${open.length} 件，共 ${incidents.length} 件紀錄，顯示最近 10 件）`);
  if (!incidents.length) out.push("沒有紀錄到事故。");
  for (const i of incidents.slice(0, 10)) {
    const span = i.endedAt ? `${formatTaipei(i.startedAt)} → ${formatTaipei(i.endedAt)}（${formatDuration(Math.round((Date.parse(i.endedAt) - Date.parse(i.startedAt)) / 60_000))}）` : `${formatTaipei(i.startedAt)} 起，尚未恢復`;
    out.push(`- [${i.endedAt ? "已恢復" : "進行中"}] ${incidentLabel(i)}・${INCIDENT_KIND_TEXT[i.kind]}：${span}。${i.detail}`);
  }
  out.push("", `完整頁面：${src.siteUrl}status/・訂閱：${src.siteUrl}data/incidents.xml`);
  return out.join("\n");
};

export const history = async (src: DataSource, feed: FeedId, date: string | undefined): Promise<string> => {
  const index = await src.archiveIndex();
  const dates = index?.feeds[feed]?.dates ?? [];
  const out = [`# 歷史存檔：${FEEDS[feed].label}（${feed}）`];
  if (!index) return [...out, "讀不到存檔索引 archive/v1/index.json。"].join("\n");
  if (!date) {
    out.push(`保留最近 ${index.retentionDays} 天；目前有 ${dates.length} 天：${dates.join("、") || "（無）"}`, `格式：${index.feeds[feed]?.format ?? "—"}`, `檔案：${src.siteUrl}archive/v1/${feed}/{YYYY-MM-DD}.json`);
    return out.join("\n");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new InputError("date 格式為 YYYY-MM-DD（台北日期）");
  if (!dates.includes(date)) throw new InputError(`${date} 沒有存檔。可用日期：${dates.join("、") || "（無）"}`);
  const day = await src.archiveDay(feed, date);
  if (!isArchiveDay(day, feed, date)) return [...out, `讀不到 ${date} 的存檔或格式不符。`].join("\n");
  out.push(`${date}（台北日期）共 ${day.samples.length} 筆，每筆是一次官方更新。`, `檔案：${src.siteUrl}archive/v1/${feed}/${date}.json`);
  if (feed === "power") {
    out.push("", "官方時間・生命週期碳強度（公克／度）・低碳占比：");
    for (const s of day.samples) {
      const d = s.data as PowerData;
      out.push(`- ${formatTaipei(d.observedAt)}・${d.intensity.lifecycle}・${d.lowCarbonPercent}%`);
    }
  } else out.push("", "各筆官方資料時間：", ...day.samples.map((s) => `- ${formatTaipei(s.sourceTime ?? s.retrievedAt)}（收集時${STATUS_TEXT[s.status]}）`));
  return out.join("\n");
};
