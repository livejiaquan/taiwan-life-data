import { useEffect, useState } from "react";
import { Footer, PageHead, STATUS_TEXT, TopBar } from "../Shell";
import { BROWSER_FETCHABLE, parseFeedEnvelope } from "@taiwan-life-data/collectors";
import { currentStatus, dataAgeMinutes, FEEDS, formatTaipei, INCIDENT_KIND_TEXT, incidentKey, incidentLabel, isStatusDoc, openCollectGap, percentile, sortIncidents, type FeedEnvelope, type FeedId, type FeedStatus, type StatusDoc } from "@taiwan-life-data/contract";

const FEED_IDS = Object.keys(FEEDS) as FeedId[];

const minutes = (n: number | null | undefined) =>
  n == null ? "—" : n < 60 ? `${n} 分` : n < 48 * 60 ? `${Math.floor(n / 60)} 小時 ${n % 60} 分` : `${Math.round(n / 1440)} 天`;

const fetchJson = async (path: string): Promise<unknown> => {
  const response = await fetch(`${import.meta.env.BASE_URL}data/${path}`, { cache: "no-cache" });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
};

type Loaded = { doc: StatusDoc | null; envelopes: Partial<Record<FeedId, FeedEnvelope<unknown> | null>>; error: boolean };

const runStats = (doc: StatusDoc) => {
  const times = doc.runs.map((r) => Date.parse(r.at));
  const gaps = times.slice(1).map((t, i) => Math.round((t - times[i]!) / 60_000));
  return { gaps, p50: percentile(gaps, 50), p95: percentile(gaps, 95), first: doc.runs[0]?.at, last: doc.runs.at(-1)?.at };
};

const feedStats = (doc: StatusDoc, feed: FeedId) => {
  const rows = doc.runs.map((r) => r.feeds[feed]).filter((f) => f !== undefined);
  const ages = rows.map((f) => f.age).filter((a): a is number => a !== null);
  return {
    n: rows.length,
    p50: percentile(ages, 50),
    p95: percentile(ages, 95),
    liveRatio: rows.length ? rows.filter((f) => f.status === "live").length / rows.length : undefined,
    failures: rows.filter((f) => !f.ok).length,
  };
};

export function StatusApp() {
  const [loaded, setLoaded] = useState<Loaded>({ doc: null, envelopes: {}, error: false });
  const now = Date.now();

  useEffect(() => {
    fetchJson("status.json")
      .then((doc) => setLoaded((prev) => ({ ...prev, doc: isStatusDoc(doc) ? doc : null, error: !isStatusDoc(doc) })))
      .catch(() => setLoaded((prev) => ({ ...prev, error: true })));
    for (const feed of FEED_IDS) {
      fetchJson(`${feed}.json`)
        .then((raw) => parseFeedEnvelope(feed, raw))
        .catch(() => null)
        .then((envelope) => setLoaded((prev) => ({ ...prev, envelopes: { ...prev.envelopes, [feed]: envelope } })));
    }
  }, []);

  const { doc, envelopes, error } = loaded;
  const stats = doc ? runStats(doc) : null;
  // A collector that has stopped cannot record its own outage, so the open gap is computed here.
  const gap = doc ? openCollectGap(doc, now) : null;
  const incidents = doc ? sortIncidents(gap ? [gap, ...doc.incidents] : doc.incidents) : [];
  const openCount = incidents.filter((i) => i.endedAt === null).length;
  const statuses = FEED_IDS.map((feed) => { const env = envelopes[feed]; return env === undefined ? null : env ? currentStatus(env, now) : "unavailable"; });
  const allLoaded = statuses.every((s) => s !== null);
  const countOf = (status: FeedStatus) => statuses.filter((s) => s === status).length;
  const others = (["delayed", "stale", "unavailable"] as const).filter((s) => countOf(s)).map((s) => `${STATUS_TEXT[s]} ${countOf(s)} 項`);

  return (
    <>
    <TopBar />
    <main className="page" id="main">
      <PageHead page="status" title="資料狀態" sub="各資料來源多新、最近何時收集成功、出過哪些狀況；每次收集自動產生。" />
      {/* The page's answer: how many sources are live right now. */}
      <section className="now answer-block" aria-label="目前狀態">
        <p className="answer" aria-live="polite">
          <span className="answer-num">{allLoaded ? countOf("live") : "—"}</span>
          <span className="answer-unit">／{FEED_IDS.length} 項資料即時</span>
        </p>
        <p className="answer-sub">
          {allLoaded ? (others.length ? others.join("、") : "全部即時") : "讀取中…"}
          {doc && (openCount ? `；進行中事故 ${openCount} 件` : "；沒有進行中的事故")}
        </p>
      </section>

      <section aria-labelledby="h-feeds">
        <h2 id="h-feeds" className="section-title">各資料來源</h2>
        <div className="status-grid">
          {FEED_IDS.map((feed) => {
            const def = FEEDS[feed];
            const env = envelopes[feed];
            const status = env === undefined ? null : env ? currentStatus(env, now) : "unavailable";
            const health = doc?.feeds[feed];
            const fs = doc ? feedStats(doc, feed) : null;
            return (
              <article key={feed} className={`tile status-card tone-${status === "live" ? "ok" : status === "delayed" ? "notice" : status ? "closed" : "loading"}`} aria-labelledby={`s-${feed}`}>
                <header className="tile-head">
                  <h3 id={`s-${feed}`}>{def.label}</h3>
                  <span className={`badge badge-${status ?? "loading"}`}>{status ? STATUS_TEXT[status] : "讀取中"}</span>
                </header>
                <dl className="kv">
                  <dt>官方資料時間</dt><dd>{formatTaipei(env?.sourceTime)}</dd>
                  <dt>資料年齡（現在）</dt><dd>{env ? minutes(dataAgeMinutes(def.freshness, env, now)) : "—"}</dd>
                  <dt>最近成功收集</dt><dd>{formatTaipei(health?.lastSuccessAt)}</dd>
                  <dt>最近一次嘗試</dt><dd>{health ? `${formatTaipei(health.lastAttemptAt)}・${health.lastAttemptOk ? "成功" : `失敗：${health.lastError ?? ""}`}` : "—"}</dd>
                  <dt>判定門檻</dt><dd>即時 ≤ {minutes(def.freshness.liveForMinutes)}；延遲 ≤ {minutes(def.freshness.delayedForMinutes)}（依{def.freshness.basis === "sourceTime" ? "官方資料時間" : "最近成功讀取時間"}）</dd>
                  <dt>官方更新</dt><dd>{def.freshness.cadence}{BROWSER_FETCHABLE.includes(feed) ? "；快照不夠新時頁面直接讀官方檔" : feed === "power" ? "；台電檔案不允許跨網域讀取，只能由伺服器端收集" : "；需金鑰，只能由伺服器端收集"}</dd>
                  {fs && fs.n > 0 && (
                    <>
                      <dt>收集時資料年齡</dt>
                      <dd>中位數 {minutes(fs.p50)}・p95 {minutes(fs.p95)}（{fs.n} 次，即時 {Math.round((fs.liveRatio ?? 0) * 100)}%，失敗 {fs.failures} 次）</dd>
                    </>
                  )}
                </dl>
                {env && env.issues.length > 0 && <p className="meta">備註：{env.issues.join("；")}</p>}
              </article>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="h-runs">
        <h2 id="h-runs" className="section-title">收集排程</h2>
        {error && <p className="verdict">讀不到狀態紀錄（data/status.json）。</p>}
        {stats && (
          <p>
            自 {formatTaipei(stats.first)} 起共 {doc!.runs.length} 次收集，最近一次 {formatTaipei(stats.last)}（{minutes(Math.round((now - Date.parse(stats.last!)) / 60_000))}前）。
            {stats.gaps.length > 0 && <> 收集間隔中位數 {minutes(stats.p50)}、p95 {minutes(stats.p95)}。</>}
          </p>
        )}
        <p className="muted">
          目前由 GitHub Actions 排程收集，實測間隔常達數小時（見 DECISIONS D2），因此氣象署與水利署的資料由頁面直接讀官方檔補足新鮮度；空品（需金鑰）與台電（不允許跨網域）只能等收集。
        </p>
      </section>

      <section aria-labelledby="h-incidents">
        <h2 id="h-incidents" className="section-title">事故紀錄</h2>
        <p className="muted">
          每次收集自動判定：讀取或驗證失敗 → 收集失敗；收集時資料過舊或無法取得 → 資料過舊；兩次收集相隔超過 1 小時 → 收集中斷。恢復時自動結案。
          訂閱：<a href={`${import.meta.env.BASE_URL}data/incidents.xml`}>Atom feed</a>；長期紀錄：<a href={`${import.meta.env.BASE_URL}archive/v1/incidents.json`}>archive/v1/incidents.json</a>（90 天）。
        </p>
        {doc && <p>{openCount ? `目前有 ${openCount} 件進行中的事故。` : "目前沒有進行中的事故。"}{incidents.length > openCount && ` 另有 ${incidents.length - openCount} 件已恢復的紀錄。`}</p>}
        {incidents.length > 0 && (
          <ul className="incidents">
            {incidents.map((i) => (
              <li key={incidentKey(i)} className={i.endedAt ? "" : "open"}>
                <strong>{i.endedAt ? "已恢復" : "進行中"}・{incidentLabel(i)}・{INCIDENT_KIND_TEXT[i.kind]}</strong>
                <span>
                  {formatTaipei(i.startedAt)} → {i.endedAt ? `${formatTaipei(i.endedAt)}（${minutes(Math.round((Date.parse(i.endedAt) - Date.parse(i.startedAt)) / 60_000))}）` : "尚未恢復"}
                </span>
                <span className="muted">
                  {i.detail}
                  {(i.runs ?? 0) > 1 && `；連續 ${i.runs} 次收集`}
                  {i.worstAgeMinutes != null && i.kind === "stale" && `；資料年齡最高 ${minutes(i.worstAgeMinutes)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="rules">判定規則：沒有資料 → 無法取得；時間缺失、無法解析或在未來 → 過舊；超過門檻 → 延遲／過舊。過舊或無法取得時首頁不下結論。</p>
      <Footer sources="交通部中央氣象署、環境部、台灣電力公司、經濟部水利署">
        <a href={`${import.meta.env.BASE_URL}data/status.json`}>status.json</a>
        <a href={`${import.meta.env.BASE_URL}data/incidents.xml`}>事故 Atom feed</a>
        <a href="https://github.com/livejiaquan/taiwan-life-data/blob/main/docs/DECISIONS.md">技術決策與實測</a>
      </Footer>
    </main>
    </>
  );
}
