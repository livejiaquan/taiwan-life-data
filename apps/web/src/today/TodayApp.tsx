import { useEffect, useState, type ReactNode } from "react";
import { isPowerProfile, type FeedDataMap, type PowerProfile } from "@taiwan-life-data/collectors";
import { dataAgeMinutes, FEEDS, formatTaipei, type FeedEnvelope } from "@taiwan-life-data/contract";
import { assessPower, CATEGORY_LABEL, pickBest, REGION_LABEL, usableProfile, reservoirRows, reservoirTone, windowText } from "@taiwan-life-data/assess";
import { loadSnapshot, readOfficial } from "../load";
import { agoText, Badge, Footer, Icon, PageHead, TopBar } from "../Shell";

const METHOD = `${import.meta.env.BASE_URL}status/#method-carbon`;

type Env<K extends keyof FeedDataMap> = FeedEnvelope<FeedDataMap[K]>;
/** undefined = loading, null = failed. */
type Slot<T> = T | null | undefined;

const fetchProfile = async (name: string): Promise<PowerProfile | null> => {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data/${name}.json`, { cache: "no-cache" });
    const value: unknown = response.ok ? await response.json() : null;
    return isPowerProfile(value) ? value : null;
  } catch {
    return null;
  }
};

function Meta({ feed, envelope, now, children }: { feed: "power" | "reservoir"; envelope: FeedEnvelope<unknown> | null; now: number; children?: ReactNode }) {
  const def = FEEDS[feed];
  const age = envelope ? dataAgeMinutes(def.freshness, envelope, now) : null;
  return (
    <div className="tile-foot">
      {envelope?.data != null && (
        <span className="when">
          資料時間 {formatTaipei(envelope.sourceTime)}
          {age !== null ? `（${agoText(age)}）` : ""}
        </span>
      )}
      {/* Provenance and method stay one tap away so the block leads with the answer. */}
      <details className="src">
        <summary>資料來源與方法</summary>
        <p>
          {envelope?.data != null && (envelope.via === "browser" ? "直接讀官方檔案，" : "本站快照，")}
          <a href={def.source.url} target="_blank" rel="noreferrer">{def.source.agency} data.gov.tw {feed === "power" ? "8931" : "45501"}</a>，{def.freshness.cadence}。
        </p>
        {children}
      </details>
    </div>
  );
}

function PowerBlock({ power, profile, now }: { power: Slot<Env<"power">>; profile: PowerProfile | null; now: number }) {
  const best = power ? pickBest([power], now) : null;
  const usable = best && (best.status === "live" || best.status === "delayed") ? best.envelope.data! : null;
  const verdict = usable ? assessPower(usable, profile, now) : null;
  const total = usable ? usable.categories.reduce((s, c) => s + Math.max(0, c.mw), 0) : 0;
  return (
    // While loading, reserve the loaded height (measured at 360–412 px) so nothing below shifts.
    <section className={`tile power-now tone-${verdict ? verdict.tone : power === undefined ? "loading" : "closed"}${power === undefined ? " reserve-power" : ""}`} aria-labelledby="h-power" aria-busy={power === undefined}>
      <header className="tile-head">
        <span className="tile-icon"><Icon name="power" /></span>
        <h2 id="h-power">電網碳強度</h2>
        <Badge status={power === undefined ? null : (best?.status ?? "unavailable")} />
      </header>
      {power === undefined && <p className="verdict muted-verdict">讀取中…</p>}
      {power !== undefined && !verdict && (
        <>
          {/* Same answer slot as the live state, with no number: the page keeps one focal point. */}
          <p className="answer answer-closed" aria-hidden="true">
            <span className="answer-label">目前每度電約</span>
            <span className="answer-num">—</span>
            <span className="answer-unit">公克 CO₂e</span>
          </p>
          <p className="verdict">{best?.status === "stale" ? "台電資料過舊，不顯示目前碳強度。" : "目前無法取得台電機組資料。"}</p>
        </>
      )}
      {verdict && usable && (
        <>
          {/* The number is the answer; the sentence form stays for screen readers. */}
          <p className="answer">
            <span className="visually-hidden">{verdict.headline}</span>
            <span className="answer-label" aria-hidden="true">目前每度電約</span>
            <span className="answer-num" aria-hidden="true">{usable.intensity.lifecycle}</span>
            <span className="answer-unit" aria-hidden="true">公克 CO₂e</span>
          </p>
          <ul className="details">{verdict.details.map((d) => <li key={d}>{d}</li>)}</ul>
          <ul className="mix" aria-label="各能源別發電占比">
            {usable.categories.filter((c) => c.mw > 0).map((c) => (
              <li key={c.category}>
                <span className="mix-label">{CATEGORY_LABEL[c.category] ?? c.category}</span>
                <span className="bar" aria-hidden="true"><span className={`bar-fill fuel-${c.category}`} style={{ width: `${(c.mw / total) * 100}%` }} /></span>
                <span className="mix-value">{((c.mw / total) * 100).toFixed(1)}%</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {power !== undefined && (
        <Meta feed="power" envelope={best?.envelope ?? power} now={now}>
          <p>
            生命週期係數（IPCC 2014 等，依 Electricity Maps 整理），儲能不計入。<a href={METHOD}>計算方法與係數出處</a>
          </p>
        </Meta>
      )}
    </section>
  );
}

function GreenHoursBlock({ profile, loading, now }: { profile: PowerProfile | null; loading: boolean; now: number }) {
  const ready = usableProfile(profile, now)?.greenest ? profile : null;
  const values = ready ? ready.hours.filter((h) => h.lifecycle !== null).map((h) => h.lifecycle!) : [];
  const min = Math.min(...values);
  const span = Math.max(1, Math.max(...values) - min);
  return (
    <section className={`tile tone-${ready ? "ok" : "unknown"}`} aria-labelledby="h-green" aria-busy={loading}>
      <header className="tile-head">
        <span className="tile-icon"><Icon name="green" /></span>
        <h2 id="h-green">綠電時段</h2>
        <span className="badge">{ready ? "最近 14 天" : loading ? "讀取中" : "樣本不足"}</span>
      </header>
      {loading && <p className="verdict muted-verdict">讀取中…</p>}
      {!loading && !ready && (
        <>
          <p className="verdict">樣本還不夠，暫不推估綠電時段。</p>
          <p className="meta">
            {!profile ? "讀不到綠電時段資料。" : profile.insufficient ? `目前累積 ${profile.samples} 筆（${profile.insufficient}）。` : `最新樣本是 ${formatTaipei(profile.to)}，超過 3 天，不再當作「最近」。`}
            需要至少 48 筆、涵蓋 18 個小時的台電資料才會計算；收集排程變準時之後會更快累積。
          </p>
        </>
      )}
      {ready && (
        <>
          <p className="verdict">通常最綠：{windowText(ready.greenest!)}</p>
          <ul className="details">
            <li>這 3 小時平均每度電 {ready.greenest!.lifecycle} 公克；最高的 {windowText(ready.dirtiest!)} 平均 {ready.dirtiest!.lifecycle} 公克</li>
            <li>想錯開用電（洗衣、充電）可以挑這段時間；這是過去的規律，不是預報</li>
          </ul>
          <div className="hours" aria-hidden="true">
            {ready.hours.map((h) => (
              <span key={h.hour} className={`hour${(h.hour - ready.greenest!.startHour + 24) % 24 < 3 ? " hour-green" : ""}`} style={{ height: h.lifecycle === null ? "0" : `${20 + ((h.lifecycle - min) / span) * 80}%` }} />
            ))}
          </div>
          <p className="hours-axis" aria-hidden="true"><span>0 時</span><span>6</span><span>12</span><span>18</span><span>23 時</span></p>
          <details>
            <summary>逐時平均（公克 CO₂e／度）</summary>
            <table className="hour-table">
              <thead><tr><th scope="col">時</th><th scope="col">平均</th><th scope="col">樣本數</th></tr></thead>
              <tbody>{ready.hours.map((h) => <tr key={h.hour}><td>{h.hour}</td><td>{h.lifecycle ?? "—"}</td><td>{h.n}</td></tr>)}</tbody>
            </table>
          </details>
          <p className="meta">依據：{ready.basis}（{formatTaipei(ready.from)} – {formatTaipei(ready.to)}，{ready.samples.toLocaleString("zh-TW")} 筆）</p>
        </>
      )}
    </section>
  );
}

function ReservoirBlock({ reservoir, refreshing, now }: { reservoir: Slot<Env<"reservoir">>; refreshing: boolean; now: number }) {
  const best = reservoir ? pickBest([reservoir], now) : null;
  const usable = best && (best.status === "live" || best.status === "delayed") ? best.envelope.data! : null;
  const regions = usable ? reservoirRows(usable, now) : null;
  return (
    <section className={`tile tone-${regions ? "unknown" : reservoir === undefined ? "loading" : "closed"}${reservoir === undefined ? " reserve-reservoir" : ""}`} aria-labelledby="h-reservoir" aria-busy={reservoir === undefined || refreshing}>
      <header className="tile-head">
        <span className="tile-icon"><Icon name="reservoir" /></span>
        <h2 id="h-reservoir">主要水庫蓄水率</h2>
        <Badge status={reservoir === undefined ? null : (best?.status ?? "unavailable")} refreshing={refreshing} />
      </header>
      {reservoir === undefined && <p className="verdict muted-verdict">讀取中…</p>}
      {reservoir !== undefined && !regions && <p className="verdict">{best?.status === "stale" ? "水情資料過舊，不顯示蓄水率。" : "目前無法取得水情資料。"}</p>}
      {regions &&
        (Object.keys(regions) as Array<keyof typeof regions>).map((region) => (
          <div key={region}>
            <h3 className="region">{REGION_LABEL[region]}</h3>
            <ul className="reservoirs">
              {regions[region].map((r) => (
                <li key={r.id}>
                  <span className="mix-label">{r.name}</span>
                  {r.fresh ? (
                    <>
                      <span className="bar" aria-hidden="true"><span className={`bar-fill tone-bg-${reservoirTone(r.percent)}`} style={{ width: `${Math.min(100, r.percent)}%` }} /></span>
                      <span className="mix-value">{r.percent}%</span>
                      <span className="res-time">{formatTaipei(r.observedAt)}</span>
                    </>
                  ) : (
                    <span className="res-time">資料過舊，不顯示</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      {reservoir !== undefined && (
        <Meta feed="reservoir" envelope={best?.envelope ?? reservoir} now={now}>
          <p>蓄水率＝有效蓄水量 ÷ 有效容量，超過 100% 照官方數字呈現。蓄水率不等於限水；是否限水以水利署與自來水公司公告為準。</p>
        </Meta>
      )}
    </section>
  );
}

/** First render (also prerendered into today/index.html) is the loading state, so hydration reuses it. */
export function TodayApp() {
  const [power, setPower] = useState<Slot<Env<"power">>>(undefined);
  const [reservoir, setReservoir] = useState<Slot<Env<"reservoir">>>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState<Slot<PowerProfile>>(undefined);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    loadSnapshot("power").then(setPower);
    fetchProfile("power-profile").then(setProfile);
    // Reservoir data is keyless and CORS-enabled: if the snapshot is not live, read WRA directly.
    loadSnapshot("reservoir").then((snapshot) => {
      setReservoir(snapshot);
      if (pickBest([snapshot], Date.now())?.status === "live") return;
      setRefreshing(true);
      readOfficial("reservoir", "").then((official) => {
        setRefreshing(false);
        const best = pickBest([snapshot, official], Date.now());
        if (best) setReservoir(best.envelope as Env<"reservoir">);
      });
    });
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const settled = power !== undefined && profile !== undefined && reservoir !== undefined && !refreshing;

  return (
    <>
      <TopBar />
      <main className="page" id="main">
        <PageHead page="today" title="今天的台灣" sub="電網現在多乾淨、主要水庫還有多少水、一天中何時用電最綠。資料過舊就不顯示。" />
        {/*
          The three blocks' loaded heights depend on the data (stale power is short, a WRA
          re-read turns a short "stale" reservoir block into 20 rows), so nothing is drawn
          until all of it is in: one taller-than-the-screen placeholder is swapped for new
          nodes, which is not a layout shift, instead of blocks resizing under each other.
        */}
        {settled ? (
          <div className="tiles tiles-today">
            <PowerBlock power={power} profile={profile ?? null} now={now} />
            <ReservoirBlock reservoir={reservoir} refreshing={false} now={now} />
            {/* Last: its height changes most (sample-count note vs. chart). */}
            <GreenHoursBlock profile={profile ?? null} loading={false} now={now} />
          </div>
        ) : (
          <div className="tiles-pending" aria-busy="true">
            <p role="status">{refreshing ? "本站水情快照不夠新，正在直接向水利署確認最新資料…" : "讀取台電與水利署資料中…"}</p>
          </div>
        )}
        <Footer sources="台灣電力公司、經濟部水利署">
          <a href={METHOD}>碳強度方法</a>
        </Footer>
      </main>
    </>
  );
}
