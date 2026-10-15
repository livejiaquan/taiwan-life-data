import { formatTaipei, type FeedStatus } from "@taiwan-life-data/contract";
import type { Tone } from "./assess";

export interface ShareItem {
  label: string;
  status: FeedStatus | null;
  tone: Tone;
  /** Verdict headline, or the fail-closed sentence when no verdict is given. */
  text: string;
  /** Official data time (or last successful read for event-driven feeds). */
  dataTime: string | null;
}

export interface ShareCard {
  place: string;
  summary: string;
  items: ShareItem[];
  url: string;
  now: number;
}

/** Shows 臺南市 instead of %E8%87%BA… — LINE links both forms. */
export const readableUrl = (url: string) => {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
};

const STATUS_WORD: Record<FeedStatus, string> = { live: "即時", delayed: "延遲", stale: "過舊", unavailable: "無法取得" };

const itemLine = (i: ShareItem) =>
  `・${i.label}：${i.text}［${i.status ? STATUS_WORD[i.status] : "讀取中"}${i.dataTime ? `，資料 ${formatTaipei(i.dataTime)}` : ""}］`;

/** Plain text for LINE / clipboard. Every item carries its data time and status. */
export const buildShareText = (card: ShareCard): string =>
  [
    `【出門前｜${card.place}】${formatTaipei(new Date(card.now).toISOString())}`,
    card.summary,
    ...card.items.map(itemLine),
    "資料：中央氣象署、環境部開放資料；過舊不下結論",
    readableUrl(card.url),
  ].join("\n");

/** https://line.me/R/share opens LINE's share picker with the text prefilled. */
export const lineShareUrl = (text: string) => `https://line.me/R/share?text=${encodeURIComponent(text)}`;

const TONE_COLOR: Record<Tone, string> = { ok: "#15803d", notice: "#a16207", warn: "#c2410c", danger: "#b91c1c", unknown: "#6b7280" };
const FONT = '"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif';

/** Splits text into lines that fit `width` (character-wise, which suits CJK). */
const wrap = (ctx: CanvasRenderingContext2D, text: string, width: number, maxLines: number): string[] => {
  const lines: string[] = [];
  let line = "";
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > width && line) {
      lines.push(line);
      line = ch;
      if (lines.length === maxLines) break;
    } else line += ch;
  }
  if (lines.length < maxLines && line) lines.push(line);
  else if (lines.length === maxLines) lines[maxLines - 1] = `${lines[maxLines - 1]!.slice(0, -1)}…`;
  return lines;
};

/** 1080×1350 PNG image card (LINE-friendly 4:5), drawn without any library. */
export const drawShareCard = async (card: ShareCard): Promise<Blob> => {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const pad = 64;

  ctx.fillStyle = "#f6f7f5";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#0f766e";
  ctx.fillRect(0, 0, W, 150);
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 34px ${FONT}`;
  ctx.fillText("台灣生活資料誌｜今天出門前", pad, 70);
  ctx.font = `400 30px ${FONT}`;
  ctx.fillText(`${formatTaipei(new Date(card.now).toISOString())} 產生・每項附官方資料時間`, pad, 118);

  let y = 230;
  ctx.fillStyle = "#1c2321";
  ctx.font = `700 64px ${FONT}`;
  ctx.fillText(card.place, pad, y);
  y += 60;
  ctx.font = `600 34px ${FONT}`;
  ctx.fillStyle = "#334155";
  for (const l of wrap(ctx, card.summary, W - pad * 2, 2)) {
    ctx.fillText(l, pad, y);
    y += 46;
  }
  y += 18;

  const rowH = (H - y - 150) / card.items.length;
  for (const item of card.items) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(pad, y, W - pad * 2, rowH - 16);
    ctx.fillStyle = TONE_COLOR[item.tone];
    ctx.fillRect(pad, y, 12, rowH - 16);
    ctx.fillStyle = "#5b6662";
    ctx.font = `600 28px ${FONT}`;
    ctx.fillText(`${item.label}・${item.status ? STATUS_WORD[item.status] : "讀取中"}`, pad + 36, y + 44);
    ctx.fillStyle = "#1c2321";
    ctx.font = `700 36px ${FONT}`;
    let ly = y + 92;
    for (const l of wrap(ctx, item.text, W - pad * 2 - 60, 2)) {
      ctx.fillText(l, pad + 36, ly);
      ly += 44;
    }
    ctx.fillStyle = "#5b6662";
    ctx.font = `400 24px ${FONT}`;
    ctx.fillText(`資料時間 ${formatTaipei(item.dataTime)}`, pad + 36, y + rowH - 34);
    y += rowH;
  }

  ctx.fillStyle = "#5b6662";
  ctx.font = `400 26px ${FONT}`;
  ctx.fillText("資料：中央氣象署、環境部開放資料（政府資料開放授權條款）", pad, H - 92);
  ctx.fillStyle = "#0f766e";
  ctx.font = `600 26px ${FONT}`;
  for (const l of wrap(ctx, readableUrl(card.url).replace(/^https?:\/\//, ""), W - pad * 2, 1)) ctx.fillText(l, pad, H - 50);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas"))), "image/png"));
};
