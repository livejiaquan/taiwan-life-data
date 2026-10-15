import { useEffect, useState } from "react";
import type { FeedDataMap } from "@taiwan-life-data/collectors";
import { COUNTIES, dataAgeMinutes, FEEDS, formatTaipei, type FeedId, type FeedStatus } from "@taiwan-life-data/contract";
import { assessAqi, assessHeat, assessUv, assessWarnings, type Verdict } from "./assess";
import { loadFeed, type LoadedFeed } from "./load";

type Loaded = { [K in FeedId]?: LoadedFeed<K> };

/** Order of the 出門前 card: warnings → heat / UV → air quality. */
const ORDER: FeedId[] = ["warnings", "heat", "uv", "aqi"];

const STATUS_TEXT: Record<FeedStatus, string> = { live: "即時", delayed: "延遲", stale: "過舊", unavailable: "無法取得" };

const readCounty = () => {
  const fromUrl = new URLSearchParams(location.search).get("county");
  return COUNTIES.some((c) => c.name === fromUrl) ? fromUrl! : "臺北市";
};

const assess = (feed: FeedId, loaded: Loaded, county: string, now: number): Verdict | null => {
  const data = loaded[feed]?.envelope?.data;
  if (!data) return null;
  switch (feed) {
    case "warnings": return assessWarnings(data as FeedDataMap["warnings"], county, now);
    case "heat": return assessHeat(data as FeedDataMap["heat"], county, now);
    case "uv": return assessUv(data as FeedDataMap["uv"], county);
    case "aqi": return assessAqi(data as FeedDataMap["aqi"], county);
  }
};

const FAIL_CLOSED: Record<"stale" | "unavailable", (feed: FeedId) => string> = {
  stale: () => "資料過舊，不做判斷。請以官方網站為準。",
  unavailable: (feed) => (feed === "warnings" ? "目前讀不到警特報——這不代表沒有警特報。" : "目前無法取得這項資料。"),
};

function FeedBlock({ feed, loaded, county, now }: { feed: FeedId; loaded: Loaded; county: string; now: number }) {
  const definition = FEEDS[feed];
  const item = loaded[feed];
  const envelope = item?.envelope;
  const status = item?.status;
  const verdict = status === "live" || status === "delayed" ? assess(feed, loaded, county, now) : null;
  const age = envelope ? dataAgeMinutes(definition.freshness, envelope, now) : null;

  return (
    <section className={`block tone-${verdict?.tone ?? "unknown"}`} aria-labelledby={`h-${feed}`}>
      <header className="block-head">
        <h2 id={`h-${feed}`}>{definition.label}</h2>
        {status ? <span className={`badge badge-${status}`}>{STATUS_TEXT[status]}</span> : <span className="badge">讀取中</span>}
      </header>
      {!item && <p className="muted">讀取中…</p>}
      {item && (status === "stale" || status === "unavailable") && <p className="verdict">{FAIL_CLOSED[status](feed)}</p>}
      {verdict && (
        <>
          <p className="verdict">{verdict.headline}</p>
          {verdict.details.length > 0 && <ul className="details">{verdict.details.map((d) => <li key={d}>{d}</li>)}</ul>}
        </>
      )}
      {item && (
        <p className="meta">
          資料時間 {formatTaipei(envelope?.sourceTime)}
          {age !== null && feed !== "warnings" ? `（約 ${age} 分鐘前）` : ""}・取得 {formatTaipei(envelope?.retrievedAt)}
          {envelope?.via === "browser" ? "（直接讀官方檔案）" : "（快照）"}・
          <a href={definition.source.url} target="_blank" rel="noreferrer">{definition.source.agency} {definition.source.datasetId}</a>
          ・{definition.freshness.cadence}
        </p>
      )}
    </section>
  );
}

export function App() {
  const [county, setCounty] = useState(readCounty);
  const [loaded, setLoaded] = useState<Loaded>({});
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    for (const feed of ORDER) {
      loadFeed(feed).then((result) => {
        if (!cancelled) setLoaded((prev) => ({ ...prev, [feed]: result }));
      });
    }
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const choose = (name: string) => {
    setCounty(name);
    const url = new URL(location.href);
    url.searchParams.set("county", name);
    history.replaceState(null, "", url);
  };

  return (
    <main className="page">
      <header className="masthead">
        <p className="brand">台灣生活資料誌</p>
        <h1>今天出門前</h1>
        <label className="picker">
          <span>縣市</span>
          <select value={county} onChange={(e) => choose(e.target.value)}>
            {COUNTIES.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </label>
      </header>

      <div className="card">
        {ORDER.map((feed) => <FeedBlock key={feed} feed={feed} loaded={loaded} county={county} now={now} />)}
        <section className="block tone-unknown" aria-labelledby="h-rain">
          <header className="block-head"><h2 id="h-rain">降雨</h2><span className="badge">建置中</span></header>
          <p className="muted">鄉鎮級降雨機率將在下一階段加入。</p>
        </section>
      </div>

      <footer className="footer">
        <p>資料來源：交通部中央氣象署、環境部開放資料（政府資料開放授權條款－第1版）。每項標示官方資料時間；資料過舊或讀不到時一律不下結論。</p>
        <p><a href="https://github.com/livejiaquan/taiwan-life-data">GitHub 原始碼（MIT）</a></p>
      </footer>
    </main>
  );
}
