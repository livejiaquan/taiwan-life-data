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

/**
 * Icon paths from Lucide (lucide-static 0.460.0, ISC licence, https://lucide.dev):
 * triangle-alert, thermometer, sun, wind, umbrella, zap, droplet, leaf, activity.
 */
const PATHS: Record<string, ReactNode> = {
  warnings: <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
  heat: <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z" />,
  uv: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></>,
  aqi: <><path d="M12.8 19.6A2 2 0 1 0 14 16H2" /><path d="M17.5 8a2.5 2.5 0 1 1 2 4H2" /><path d="M9.8 4.4A2 2 0 1 1 11 8H2" /></>,
  rain: <><path d="M22 12a10.06 10.06 1 0 0-20 0Z" /><path d="M12 12v8a2 2 0 0 0 4 0" /><path d="M12 2v1" /></>,
  power: <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />,
  reservoir: <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" />,
  green: <><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" /><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" /></>,
  status: <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />,
};

export function Icon({ name }: { name: keyof typeof PATHS }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
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
      <a className="skip" href="#main">跳到主要內容</a>
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
