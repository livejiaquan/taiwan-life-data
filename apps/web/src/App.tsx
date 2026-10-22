import { useEffect, useMemo, useState } from "react";
import { BROWSER_FETCHABLE, rainDatasetId, type BrowserFeedId } from "@taiwan-life-data/collectors";
import { COUNTIES, dataAgeMinutes, FEEDS, formatTaipei, townsOf, type FeedEnvelope, type FeedId, type FeedStatus, type Town } from "@taiwan-life-data/contract";
import { assessCard, covers, FAIL_CLOSED, ORDER, SHORT_LABEL, summarize, type CardFeed, type Verdict } from "@taiwan-life-data/assess";
import { pickBest } from "@taiwan-life-data/assess";
import { loadSnapshot, readOfficial } from "./load";
import { placeUrl, readPlace, savePlace } from "./place";
import { ShareBar } from "./ShareBar";
import { agoText, Badge, Footer, Icon, TONE_TEXT, TopBar } from "./Shell";
import type { ShareItem } from "./share";

type AnyEnvelope = FeedEnvelope<unknown>;
/** undefined = still loading, null = failed. */
type Snapshots = Partial<Record<FeedId, AnyEnvelope | null>>;
/** Keyed by feed, or `rain:<county>` (rain is read one county at a time). */
type Official = Record<string, AnyEnvelope | null | "loading">;

const officialKey = (feed: FeedId, county: string) => (feed === "rain" ? `rain:${county}` : feed);

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
    const verdict = best.status === "live" || best.status === "delayed" ? assessCard(feed, best.envelope.data, town, now) : null;
    return { feed, pending: false, refreshing: loading, envelope: best.envelope, status: best.status, verdict };
  });
}

const dataTimeOf = (feed: FeedId, envelope: AnyEnvelope | null) =>
  envelope ? (FEEDS[feed].freshness.basis === "retrievedAt" ? envelope.retrievedAt : envelope.sourceTime) : null;

/** A view's level word and colour class: the tone when there is a verdict, otherwise loading or fail-closed. */
const levelOf = (view: FeedView): { cls: string; text: string } => {
  if (view.pending) return { cls: "loading", text: "讀取中" };
  if (!view.verdict) return { cls: "closed", text: view.status === "stale" ? "過舊" : "讀不到" };
  return { cls: view.verdict.tone, text: TONE_TEXT[view.verdict.tone] };
};

const TODAY = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "long", day: "numeric", weekday: "short" });

function FeedBlock({ view, town, now }: { view: FeedView; town: Town | null; now: number }) {
  const { feed, envelope, status, verdict, pending, refreshing } = view;
  const definition = FEEDS[feed];
  const age = envelope ? dataAgeMinutes(definition.freshness, envelope, now) : null;
  const datasetId = (feed === "rain" && town && rainDatasetId(town.county)) || definition.source.datasetId;
  const sourceUrl = feed === "rain" ? `https://opendata.cwa.gov.tw/dataset/forecast/${datasetId}` : definition.source.url;
  const level = levelOf(view);

  return (
    <section id={`b-${feed}`} className={`tile tone-${level.cls}${feed === "warnings" ? " tile-wide" : ""}`} aria-labelledby={`h-${feed}`} aria-busy={pending || refreshing}>
      <header className="tile-head">
        <span className="tile-icon"><Icon name={feed} /></span>
        <h2 id={`h-${feed}`}>{definition.label}</h2>
        <span className="level">{level.text}</span>
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
        <footer className="tile-foot">
          {/* Refresh state lives in the badge so the tile height does not change. */}
          <Badge status={status} refreshing={refreshing} />
          {envelope?.data != null && (
            <span className="when">
              資料時間 <time dateTime={dataTimeOf(feed, envelope) ?? undefined}>{formatTaipei(dataTimeOf(feed, envelope))}</time>
              {age !== null && feed !== "warnings" ? `（${agoText(age)}）` : ""}
            </span>
          )}
          <span className="src">
            {envelope?.data != null && (envelope.via === "browser" ? "直接讀官方檔案，" : "本站快照，")}
            <a href={sourceUrl} target="_blank" rel="noreferrer">{definition.source.agency} {datasetId}</a>，{definition.freshness.cadence}
          </span>
        </footer>
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

  const loading = views.some((v) => v.pending);
  const [headline, ...rest] = summary.text.split("；");
  const closed = views.filter((v) => !v.pending && !v.verdict).length;
  const freshness = loading
    ? "正在讀取各項官方資料"
    : closed
      ? `${closed} 項資料過舊或讀不到，這幾項不下結論`
      : `${views.length} 項資料都在時效內`;

  return (
    <>
      <TopBar page="home" />
      <main className="page">
        <div className="intro">
          <p className="lede">選鄉鎮市區，一張卡看今天出門要注意什麼。每項都標示官方資料時間；資料過舊就不下結論。</p>
          <Picker town={town} onChange={choose} />
        </div>

        <section className={`hero tone-${loading ? "loading" : summary.tone}`} aria-labelledby="h-place">
          <div className="hero-top">
            <h1 id="h-place" className="hero-place">{place || "今天出門前"}</h1>
            <p className="hero-date">{town ? `${TODAY.format(now)}，出門前` : " "}</p>
          </div>
          <div className="hero-answer" role="status" aria-live="polite">
            <p className="hero-headline">{headline}</p>
            <p className="hero-rest">{rest.length ? rest.join("；") : " "}</p>
          </div>
          <ul className="glance" aria-label="五項重點，點選可看細節">
            {views.map((v) => {
              const level = levelOf(v);
              return (
                <li key={v.feed}>
                  <a className={`chip tone-${level.cls}`} href={`#b-${v.feed}`}>
                    <Icon name={v.feed} />
                    <span className="chip-label">{SHORT_LABEL[v.feed]}</span>
                    <span className="chip-level">{level.text}</span>
                  </a>
                </li>
              );
            })}
          </ul>
          <p className={`hero-fresh${closed ? " has-closed" : ""}`}>{freshness}</p>
        </section>

        <div className="tiles">
          {views.map((view) => <FeedBlock key={view.feed} view={view} town={town} now={now} />)}
        </div>

        {town && <ShareBar card={{ place, summary: summary.text, items: shareItems, url: placeUrl(town), now }} ready={views.every((v) => !v.pending)} />}

        <Footer sources="交通部中央氣象署、環境部" />
      </main>
    </>
  );
}
