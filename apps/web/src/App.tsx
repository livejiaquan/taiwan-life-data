import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BROWSER_FETCHABLE, rainDatasetId, type BrowserFeedId, type FeedDataMap } from "@taiwan-life-data/collectors";
import { COUNTIES, dataAgeMinutes, FEEDS, formatTaipei, townsOf, type FeedEnvelope, type FeedId, type FeedStatus, type Town } from "@taiwan-life-data/contract";
import { assessAqi, assessHeat, assessRain, assessUv, assessWarnings, summarize, type Verdict } from "./assess";
import { loadSnapshot, pickBest, readOfficial } from "./load";
import { placeUrl, readPlace, savePlace } from "./place";
import { ShareBar } from "./ShareBar";
import type { ShareItem } from "./share";

/** Order of the 出門前 card (PLAN): warnings → heat / UV → air quality → rain. */
type CardFeed = "warnings" | "heat" | "uv" | "aqi" | "rain";
export const ORDER: CardFeed[] = ["warnings", "heat", "uv", "aqi", "rain"];

const STATUS_TEXT: Record<FeedStatus, string> = { live: "即時", delayed: "延遲", stale: "過舊", unavailable: "無法取得" };
const SHORT_LABEL: Record<CardFeed, string> = { warnings: "警特報", heat: "熱傷害", uv: "紫外線", aqi: "空品", rain: "降雨" };

type AnyEnvelope = FeedEnvelope<unknown>;
/** undefined = still loading, null = failed. */
type Snapshots = Partial<Record<FeedId, AnyEnvelope | null>>;
/** Keyed by feed, or `rain:<county>` (rain is read one county at a time). */
type Official = Record<string, AnyEnvelope | null | "loading">;

const officialKey = (feed: FeedId, county: string) => (feed === "rain" ? `rain:${county}` : feed);

/** Rain snapshots can miss a county (partial collect); treat that as "no data here". */
const covers = (feed: FeedId, envelope: AnyEnvelope | null | undefined, town: Town) =>
  !!envelope?.data && (feed !== "rain" || (envelope.data as FeedDataMap["rain"]).towns.some((t) => t.geocode === town.geocode));

const assess = (feed: CardFeed, data: unknown, town: Town, now: number): Verdict => {
  switch (feed) {
    case "warnings": return assessWarnings(data as FeedDataMap["warnings"], town, now);
    case "heat": return assessHeat(data as FeedDataMap["heat"], town, now);
    case "uv": return assessUv(data as FeedDataMap["uv"], town, now);
    case "aqi": return assessAqi(data as FeedDataMap["aqi"], town, now);
    case "rain": return assessRain(data as FeedDataMap["rain"], town, now);
  }
};

const FAIL_CLOSED: Record<"stale" | "unavailable", (feed: FeedId) => string> = {
  stale: () => "資料過舊，不做判斷。請以官方網站為準。",
  unavailable: (feed) => (feed === "warnings" ? "目前讀不到警特報——這不代表沒有警特報。" : "目前無法取得這項資料。"),
};

interface FeedView {
  feed: CardFeed;
  pending: boolean;
  refreshing: boolean;
  envelope: AnyEnvelope | null;
  status: FeedStatus | null;
  verdict: Verdict | null;
}

function useFeeds(town: Town | null, now: number): FeedView[] {
  const [snapshots, setSnapshots] = useState<Snapshots>({});
  const [official, setOfficial] = useState<Official>({});

  useEffect(() => {
    let cancelled = false;
    for (const feed of ORDER) {
      loadSnapshot(feed).then((envelope) => {
        if (!cancelled) setSnapshots((prev) => ({ ...prev, [feed]: envelope }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // When the snapshot is not live (or misses this county), read the official file directly.
  useEffect(() => {
    if (!town) return;
    for (const feed of ORDER) {
      if (!BROWSER_FETCHABLE.includes(feed) || snapshots[feed] === undefined) continue;
      const key = officialKey(feed, town.county);
      if (official[key] !== undefined) continue;
      const snapshot = snapshots[feed];
      const best = covers(feed, snapshot, town) ? pickBest([snapshot], Date.now()) : null;
      if (best?.status === "live") continue;
      setOfficial((prev) => ({ ...prev, [key]: "loading" }));
      readOfficial(feed as BrowserFeedId, town.county).then((envelope) => setOfficial((prev) => ({ ...prev, [key]: envelope })));
    }
  }, [snapshots, official, town]);

  return ORDER.map((feed): FeedView => {
    if (!town) return { feed, pending: true, refreshing: false, envelope: null, status: null, verdict: null };
    const snapshot = snapshots[feed];
    const fromOfficial = official[officialKey(feed, town.county)];
    const loading = fromOfficial === "loading";
    const candidates = [snapshot, loading ? null : fromOfficial].filter((e) => covers(feed, e, town));
    const best = pickBest(candidates, now);
    const pending = snapshot === undefined || (!best && loading);
    if (!best) {
      return { feed, pending, refreshing: false, envelope: snapshot ?? null, status: pending ? null : "unavailable", verdict: null };
    }
    const verdict = best.status === "live" || best.status === "delayed" ? assess(feed, best.envelope.data, town, now) : null;
    return { feed, pending: false, refreshing: loading, envelope: best.envelope, status: best.status, verdict };
  });
}

const dataTimeOf = (feed: FeedId, envelope: AnyEnvelope | null) =>
  envelope ? (FEEDS[feed].freshness.basis === "retrievedAt" ? envelope.retrievedAt : envelope.sourceTime) : null;

function FeedBlock({ view, town, now }: { view: FeedView; town: Town | null; now: number }) {
  const { feed, envelope, status, verdict, pending, refreshing } = view;
  const definition = FEEDS[feed];
  const age = envelope ? dataAgeMinutes(definition.freshness, envelope, now) : null;
  const datasetId = (feed === "rain" && town && rainDatasetId(town.county)) || definition.source.datasetId;
  const sourceUrl = feed === "rain" ? `https://opendata.cwa.gov.tw/dataset/forecast/${datasetId}` : definition.source.url;

  return (
    <section className={`block tone-${verdict?.tone ?? "unknown"}`} aria-labelledby={`h-${feed}`} aria-busy={pending || refreshing}>
      <header className="block-head">
        <h2 id={`h-${feed}`}>{definition.label}</h2>
        {/* Refresh state lives in the badge so the block height does not change. */}
        <span className={`badge badge-${status ?? "loading"}`}>{status ? `${STATUS_TEXT[status]}${refreshing ? "・確認中" : ""}` : "讀取中"}</span>
      </header>
      {pending && <p className="verdict muted-verdict">讀取中…</p>}
      {!pending && !verdict && status !== "live" && status !== "delayed" && <p className="verdict">{FAIL_CLOSED[status === "stale" ? "stale" : "unavailable"](feed)}</p>}
      {verdict && (
        <>
          <p className="verdict">{verdict.headline}</p>
          {verdict.details.length > 0 && <ul className="details">{verdict.details.map((d) => <li key={d}>{d}</li>)}</ul>}
        </>
      )}
      {!pending && (
        <p className="meta">
          {envelope?.data != null && (
            <>
              資料時間 {formatTaipei(dataTimeOf(feed, envelope))}
              {age !== null && feed !== "warnings" ? `（約 ${age} 分鐘前）` : ""}
              {envelope.via === "browser" ? "・直接讀官方檔案" : "・本站快照"}・
            </>
          )}
          <a href={sourceUrl} target="_blank" rel="noreferrer">{definition.source.agency} {datasetId}</a>・{definition.freshness.cadence}
        </p>
      )}
    </section>
  );
}

/** Before the place is resolved (prerendered HTML, first client render) the pickers are disabled placeholders. */
function Picker({ town, onChange }: { town: Town | null; onChange: (t: Town) => void }) {
  return (
    <div className="picker">
      <label>
        <span>縣市</span>
        {town ? (
          <select value={town.county} onChange={(e) => onChange(townsOf(e.target.value)[0]!)}>
            {COUNTIES.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        ) : (
          <select disabled><option>載入中</option></select>
        )}
      </label>
      <label>
        <span>鄉鎮市區</span>
        {town ? (
          <select value={town.geocode} onChange={(e) => onChange(townsOf(town.county).find((t) => t.geocode === e.target.value)!)}>
            {townsOf(town.county).map((t) => <option key={t.geocode} value={t.geocode}>{t.town}</option>)}
          </select>
        ) : (
          <select disabled><option>載入中</option></select>
        )}
      </label>
    </div>
  );
}

export function Masthead({ children }: { children?: ReactNode }) {
  return (
    <header className="masthead">
      <p className="brand">台灣生活資料誌</p>
      <h1>今天出門前</h1>
      <p className="lede">選鄉鎮市區，依序看警特報、熱傷害、紫外線、空氣品質、降雨。每項都標示官方資料時間；資料過舊就不下結論。</p>
      {children}
    </header>
  );
}

/**
 * The first render (also prerendered into index.html by scripts/prerender.ts) has
 * no place yet, so hydration reuses the static nodes and the first paint needs no JS.
 */
export function App() {
  const [town, setTown] = useState<Town | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const views = useFeeds(town, now);

  useEffect(() => {
    setTown(readPlace(location.search));
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const choose = (next: Town) => {
    setTown(next);
    savePlace(next);
  };

  const summary = summarize(views.map((v) => ({ label: SHORT_LABEL[v.feed], verdict: v.verdict, pending: v.pending })));
  const place = town ? `${town.county}${town.town}` : "";
  const shareItems = useMemo(
    (): ShareItem[] =>
      views.map((v) => ({
        label: FEEDS[v.feed].label,
        status: v.status,
        tone: v.verdict?.tone ?? "unknown",
        text: v.verdict?.headline ?? (v.pending ? "讀取中" : FAIL_CLOSED[v.status === "stale" ? "stale" : "unavailable"](v.feed)),
        dataTime: v.envelope?.data != null ? dataTimeOf(v.feed, v.envelope) : null,
      })),
    [views],
  );

  return (
    <main className="page">
      <Masthead>
        <Picker town={town} onChange={choose} />
      </Masthead>

      <div className="card">
        <div className={`summary tone-${summary.tone}`} role="status" aria-live="polite">
          <p className="summary-place">{place || "\u00a0"}</p>
          <p className="summary-text">{summary.text}</p>
        </div>
        {views.map((view) => <FeedBlock key={view.feed} view={view} town={town} now={now} />)}
      </div>

      {town && <ShareBar card={{ place, summary: summary.text, items: shareItems, url: placeUrl(town), now }} ready={views.every((v) => !v.pending)} />}

      <footer className="footer">
        <p>資料來源：交通部中央氣象署、環境部開放資料（政府資料開放授權條款－第1版）。資料過舊或讀不到時一律不下結論。</p>
        <p>
          <a href={`${import.meta.env.BASE_URL}today/`}>今天的台灣（電網碳強度、水庫）</a>・<a href={`${import.meta.env.BASE_URL}status/`}>資料狀態與事故紀錄</a>・<a href="https://github.com/livejiaquan/taiwan-life-data/blob/main/docs/API.md">開放 JSON API</a>・<a href="https://github.com/livejiaquan/taiwan-life-data">GitHub 原始碼（MIT）</a>
        </p>
      </footer>
    </main>
  );
}
