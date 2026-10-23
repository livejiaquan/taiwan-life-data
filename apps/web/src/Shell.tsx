import { useEffect, useState, type ReactNode } from "react";
import { Activity, Droplet, Leaf, Sun, SunMoon, Thermometer, TriangleAlert, Umbrella, Wind, Zap, type LucideIcon } from "lucide-react";
import type { FeedStatus } from "@taiwan-life-data/contract";

export const STATUS_TEXT: Record<FeedStatus, string> = { live: "即時", delayed: "延遲", stale: "過舊", unavailable: "無法取得" };
/** Words next to every tone colour, so colour is never the only signal (MeteoAlarm-style ramp, docs/design-research.md). */
export const TONE_TEXT = { ok: "正常", notice: "留意", warn: "注意", danger: "警戒", unknown: "無法判斷" } as const;

const BASE = import.meta.env.BASE_URL;

/** "約 5 小時前" reads better than "337 分鐘前". */
export const agoText = (minutes: number | null): string =>
  minutes === null ? "" : minutes < 1 ? "剛剛" : minutes < 60 ? `${minutes} 分鐘前` : minutes < 48 * 60 ? `約 ${Math.round(minutes / 60)} 小時前` : `約 ${Math.round(minutes / 1440)} 天前`;

/**
 * Every UI icon is Lucide (lucide-react, ISC licence, https://lucide.dev), drawn the same
 * way: 24px grid, 1.75 stroke, round caps and joins, currentColor. Sizes are 16 / 20 / 24 only.
 */
const ICONS = { warnings: TriangleAlert, heat: Thermometer, uv: Sun, aqi: Wind, rain: Umbrella, power: Zap, reservoir: Droplet, green: Leaf, status: Activity } satisfies Record<string, LucideIcon>;

export function Icon({ name, size = 24 }: { name: keyof typeof ICONS; size?: 16 | 20 | 24 }) {
  const Glyph = ICONS[name];
  return <Glyph className="icon" size={size} strokeWidth={1.75} aria-hidden="true" focusable="false" />;
}

/**
 * The brand mark, shared by every site in this series: a rounded square (radius 22% of its
 * side) in the site's accent, with one white Lucide icon at 58% of the side. Same drawing as
 * public/brand/mark.svg (favicon) and docs/brand/.
 */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg className="brand-mark" viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14.08" fill="var(--brand-accent)" />
      <g transform="translate(13.44 13.44) scale(1.5467)" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z" />
      </g>
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
      <SunMoon className="icon" size={20} strokeWidth={1.75} aria-hidden="true" focusable="false" />
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

/** Yr.no's header: brand on the left, the one action on the right. */
export function TopBar() {
  return (
    <header className="topbar">
      <a className="skip" href="#main">跳到主要內容</a>
      <div className="topbar-inner">
        <a className="brand" href={BASE}>
          <BrandMark />
          <span className="brand-words">
            <span className="brand-name">台灣生活資料誌</span>
            <span className="brand-sub">官方開放資料，出門前看一眼</span>
          </span>
        </a>
        <ThemeToggle />
      </div>
    </header>
  );
}

/** Yr.no's place header: the page's title and a small subtitle, then the page tabs. */
export function PageHead({ page, title, sub, children }: { page: Page; title: string; sub: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="page-title">
        <h1>{title}</h1>
        <p className="page-sub">{sub}</p>
      </div>
      <nav className="tabs" aria-label="主要頁面">
        {NAV.map(([id, label, href]) => (
          <a key={id} href={href} aria-current={id === page ? "page" : undefined}>{label}</a>
        ))}
      </nav>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}

export function Footer({ sources, children }: { sources: string; children?: ReactNode }) {
  return (
    <footer className="footer">
      <p>資料來源：{sources}開放資料（政府資料開放授權條款－第1版）。本站不代表各機關立場；警特報與防災資訊以官方發布為準。資料過舊或讀不到時一律不下結論。</p>
      <p className="footer-links">
        {children}
        <a href={`${BASE}data/catalog.json`}>開放 JSON API（目錄）</a>
        <a href={`${BASE}status/`}>資料狀態與方法</a>
      </p>
      <p className="footer-mcp">
        在支援 MCP 的客戶端（Claude Desktop、Cursor 等）使用：<code>npx -y taiwan-life-data-mcp</code>
      </p>
      <p className="footer-copy">© 2026 台灣生活資料誌</p>
    </footer>
  );
}
