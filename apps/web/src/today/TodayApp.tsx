import { useEffect, useState } from "react";
import { isPowerProfile, type FeedDataMap, type PowerProfile } from "@taiwan-life-data/collectors";
import { dataAgeMinutes, FEEDS, formatTaipei, type FeedEnvelope, type FeedStatus } from "@taiwan-life-data/contract";
import { loadSnapshot, pickBest, readOfficial } from "../load";
import { assessPower, CATEGORY_LABEL, REGION_LABEL, reservoirRows, reservoirTone, windowText } from "./today";

const STATUS_TEXT: Record<FeedStatus, string> = { live: "即時", delayed: "延遲", stale: "過舊", unavailable: "無法取得" };
const REPO = "https://github.com/livejiaquan/taiwan-life-data/blob/main";

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

function Badge({ status, refreshing }: { status: FeedStatus | null; refreshing?: boolean }) {
  return <span className={`badge badge-${status ?? "loading"}`}>{status ? `${STATUS_TEXT[status]}${refreshing ? "・確認中" : ""}` : "讀取中"}</span>;
}

function Meta({ feed, envelope, now }: { feed: "power" | "reservoir"; envelope: FeedEnvelope<unknown> | null; now: number }) {
  const def = FEEDS[feed];
  const age = envelope ? dataAgeMinutes(def.freshness, envelope, now) : null;
  return (
    <p className="meta">
      {envelope?.data != null && (
        <>
          資料時間 {formatTaipei(envelope.sourceTime)}
          {age !== null ? `（約 ${age} 分鐘前）` : ""}
          {envelope.via === "browser" ? "・直接讀官方檔案" : "・本站快照"}・
        </>
      )}
      <a href={def.source.url} target="_blank" rel="noreferrer">{def.source.agency} data.gov.tw {feed === "power" ? "8931" : "45501"}</a>・{def.freshness.cadence}
    </p>
  );
}

function PowerBlock({ power, profile, now }: { power: Slot<Env<"power">>; profile: PowerProfile | null; now: number }) {
  const best = power ? pickBest([power], now) : null;
  const usable = best && (best.status === "live" || best.status === "delayed") ? best.envelope.data! : null;
  const verdict = usable ? assessPower(usable, profile) : null;
  const total = usable ? usable.categories.reduce((s, c) => s + Math.max(0, c.mw), 0) : 0;
  return (
    <section className={`block tone-${verdict?.tone ?? "unknown"}`} aria-labelledby="h-power" aria-busy={power === undefined}>
      <header className="block-head">
        <h2 id="h-power">電網碳強度</h2>
        <Badge status={power === undefined ? null : (best?.status ?? "unavailable")} />
      </header>
      {power === undefined && <p className="verdict muted-verdict">讀取中…</p>}
      {power !== undefined && !verdict && (
        <p className="verdict">{best?.status === "stale" ? "台電資料過舊，不顯示目前碳強度。" : "目前無法取得台電機組資料。"}</p>
      )}
      {verdict && usable && (
        <>
          <p className="verdict">{verdict.headline}</p>
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
      {power !== undefined && <Meta feed="power" envelope={best?.envelope ?? power} now={now} />}
      <p className="meta">
        生命週期係數（IPCC 2014 等，依 Electricity Maps 整理），儲能不計入。<a href={`${REPO}/docs/METHODOLOGY-carbon.md`}>計算方法與係數出處</a>
      </p>
    </section>
  );
}

function GreenHoursBlock({ profile, loading }: { profile: PowerProfile | null; loading: boolean }) {
  const ready = profile?.greenest && profile.dirtiest ? profile : null;
  const values = ready ? ready.hours.filter((h) => h.lifecycle !== null).map((h) => h.lifecycle!) : [];
  const min = Math.min(...values);
  const span = Math.max(1, Math.max(...values) - min);
  return (
    <section className={`block tone-${ready ? "ok" : "unknown"}`} aria-labelledby="h-green" aria-busy={loading}>
      <header className="block-head">
        <h2 id="h-green">綠電時段</h2>
        <span className="badge">{ready ? "最近 14 天" : loading ? "讀取中" : "樣本不足"}</span>
      </header>
      {loading && <p className="verdict muted-verdict">讀取中…</p>}
      {!loading && !ready && (
        <>
          <p className="verdict">樣本還不夠，暫不推估綠電時段。</p>
          <p className="meta">
            {profile ? `目前累積 ${profile.samples} 筆（${profile.insufficient}）。` : "讀不到綠電時段資料。"}
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
    <section className="block tone-unknown" aria-labelledby="h-reservoir" aria-busy={reservoir === undefined || refreshing}>
      <header className="block-head">
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
      {reservoir !== undefined && <Meta feed="reservoir" envelope={best?.envelope ?? reservoir} now={now} />}
      <p className="meta">蓄水率＝有效蓄水量 ÷ 有效容量，超過 100% 照官方數字呈現。蓄水率不等於限水；是否限水以水利署與自來水公司公告為準。</p>
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

  return (
    <main className="page">
      <header className="masthead">
        <p className="brand"><a href={import.meta.env.BASE_URL}>台灣生活資料誌</a></p>
        <h1>今天的台灣</h1>
        <p className="lede">電網現在多「乾淨」、一天中哪段時間用電最綠、主要水庫還有多少水。每項都標示官方資料時間；資料過舊就不顯示。</p>
      </header>
      <div className="card">
        <PowerBlock power={power} profile={profile ?? null} now={now} />
        <GreenHoursBlock profile={profile ?? null} loading={profile === undefined} />
        <ReservoirBlock reservoir={reservoir} refreshing={refreshing} now={now} />
      </div>
      <footer className="footer">
        <p>資料來源：台灣電力公司、經濟部水利署開放資料（政府資料開放授權條款－第1版）。本站不代表各機關立場。</p>
        <p>
          <a href={import.meta.env.BASE_URL}>出門前</a>・<a href={`${import.meta.env.BASE_URL}status/`}>資料狀態</a>・<a href={`${REPO}/docs/API.md`}>開放 JSON API</a>・<a href={`${REPO}/docs/METHODOLOGY-carbon.md`}>碳強度方法</a>
        </p>
      </footer>
    </main>
  );
}
