import { useEffect, useState, type ReactNode } from "react";
import type { FeedStatus } from "@taiwan-life-data/contract";

export const STATUS_TEXT: Record<FeedStatus, string> = { live: "即時", delayed: "延遲", stale: "過舊", unavailable: "無法取得" };
/** Words next to every tone colour, so colour is never the only signal (MeteoAlarm-style ramp, docs/design-research.md). */
export const TONE_TEXT = { ok: "正常", notice: "留意", warn: "注意", danger: "警戒", unknown: "無法判斷" } as const;

const BASE = import.meta.env.BASE_URL;
const REPO = "https://github.com/livejiaquan/taiwan-life-data";

/** "約 5 小時前" reads better than "337 分鐘前". */
export const agoText = (minutes: number | null): string =>
  minutes === null ? "" : minutes < 1 ? "剛剛" : minutes < 60 ? `${minutes} 分鐘前` : minutes < 48 * 60 ? `約 ${Math.round(minutes / 60)} 小時前` : `約 ${Math.round(minutes / 1440)} 天前`;

const PATHS: Record<string, ReactNode> = {
  warnings: <><path d="M12 3.5 2.8 19.5h18.4Z" /><path d="M12 9.5v4.5M12 17v.01" /></>,
  heat: <><path d="M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0Z" /><path d="M12 9v7" /></>,
  uv: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>,
  aqi: <><path d="M3 8.5h11a2.5 2.5 0 1 0-2.5-2.5" /><path d="M3 12.5h15a2.5 2.5 0 1 1-2.5 2.5" /><path d="M3 16.5h7" /></>,
  rain: <><path d="M3 12a9 9 0 0 1 18 0Z" /><path d="M12 12v6.5a2 2 0 0 1-4 0" /><path d="M12 3v-.5" /></>,
  power: <path d="M13 2.5 5 13.5h6l-1 8 8-11h-6Z" />,
  reservoir: <path d="M12 3s-6 6.5-6 11a6 6 0 0 0 12 0c0-4.5-6-11-6-11Z" />,
  green: <><path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14Z" /><path d="M5 19 13 11" /></>,
  status: <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />,
};

export function Icon({ name }: { name: keyof typeof PATHS }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}

export function Badge({ status, refreshing }: { status: FeedStatus | null; refreshing?: boolean }) {
  return <span className={`badge badge-${status ?? "loading"}`}>{status ? `${STATUS_TEXT[status]}${refreshing ? "，確認中" : ""}` : "讀取中"}</span>;
}

type Theme = "auto" | "light" | "dark";
const THEME_KEY = "tld:theme";
const NEXT: Record<Theme, Theme> = { auto: "light", light: "dark", dark: "auto" };
const THEME_TEXT: Record<Theme, string> = { auto: "跟隨系統", light: "淺色", dark: "深色" };

/** The stored choice is applied before first paint by the inline script in each page's <head>. */
function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("auto");
  useEffect(() => {
    const saved = document.documentElement.dataset.theme;
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);
  const cycle = () => {
    const next = NEXT[theme];
    setTheme(next);
    if (next === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    try {
      if (next === "auto") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      // Private mode: the choice lasts for this page only.
    }
  };
  return (
    <button className="theme-toggle" type="button" onClick={cycle} aria-label={`外觀：${THEME_TEXT[theme]}（按一下切換）`}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" />
      </svg>
      <span className="theme-text">{THEME_TEXT[theme]}</span>
    </button>
  );
}

type Page = "home" | "today" | "status";
const NAV: Array<[Page, string, string]> = [
  ["home", "出門前", BASE],
  ["today", "今天的台灣", `${BASE}today/`],
  ["status", "資料狀態", `${BASE}status/`],
];

export function TopBar({ page }: { page: Page }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="brand" href={BASE}>
          <span className="brand-mark" aria-hidden="true">台</span>
          台灣生活資料誌
        </a>
        <nav className="nav" aria-label="主要頁面">
          {NAV.map(([id, label, href]) => (
            <a key={id} href={href} aria-current={id === page ? "page" : undefined}>{label}</a>
          ))}
        </nav>
        <ThemeToggle />
      </div>
    </header>
  );
}

export function Footer({ sources, children }: { sources: string; children?: ReactNode }) {
  return (
    <footer className="footer">
      <p>資料來源：{sources}開放資料（政府資料開放授權條款－第1版）。本站不代表各機關立場；警特報與防災資訊以官方發布為準。資料過舊或讀不到時一律不下結論。</p>
      <p className="footer-links">
        {children}
        <a href={`${REPO}/blob/main/docs/API.md`}>開放 JSON API</a>
        <a href={`${REPO}/tree/main/packages/mcp-server`}>MCP server</a>
        <a href={REPO}>GitHub 原始碼（MIT）</a>
      </p>
    </footer>
  );
}
