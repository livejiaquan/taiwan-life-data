import { useState } from "react";
import { buildShareText, drawShareCard, lineShareUrl, type ShareCard } from "./share";

const fileName = (card: ShareCard) => `出門前-${card.place}.png`;

export function ShareBar({ card, ready }: { card: ShareCard; ready: boolean }) {
  const [message, setMessage] = useState("");
  const [fallbackText, setFallbackText] = useState<string | null>(null);
  const [image, setImage] = useState<{ url: string; name: string } | null>(null);
  const text = buildShareText(card);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setFallbackText(null);
      setMessage("已複製，可以直接貼到 LINE。");
    } catch {
      setFallbackText(text);
      setMessage("無法自動複製，請長按下方文字複製。");
    }
  };

  const makeImage = async () => {
    setMessage("產生圖卡中…");
    try {
      const blob = await drawShareCard(card);
      const file = new File([blob], fileName(card), { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text });
          setMessage("");
          return;
        } catch (error) {
          if ((error as Error).name === "AbortError") {
            setMessage("");
            return;
          }
        }
      }
      if (image) URL.revokeObjectURL(image.url);
      setImage({ url: URL.createObjectURL(blob), name: fileName(card) });
      setMessage("圖卡已產生，可下載或長按圖片儲存後傳到 LINE。");
    } catch {
      setMessage("這個瀏覽器無法產生圖卡，請改用文字分享。");
    }
  };

  return (
    <section className="share" aria-labelledby="h-share">
      <h2 id="h-share">分享給家人</h2>
      <p className="muted">分享內容含每項的資料時間與狀態{ready ? "" : "（仍有項目讀取中）"}。</p>
      <div className="share-actions">
        <a className="btn btn-line" href={lineShareUrl(text)} target="_blank" rel="noreferrer">傳到 LINE</a>
        <button className="btn" type="button" onClick={copy}>複製文字</button>
        <button className="btn" type="button" onClick={makeImage}>產生圖卡</button>
      </div>
      <p className="share-status" role="status" aria-live="polite">{message}</p>
      {fallbackText !== null && <textarea className="share-fallback" readOnly value={fallbackText} rows={8} aria-label="分享文字" onFocus={(e) => e.currentTarget.select()} />}
      {image && (
        <figure className="share-image">
          <img src={image.url} alt={`${card.place}出門前圖卡`} width={1080} height={1350} />
          <figcaption><a className="btn" href={image.url} download={image.name}>下載圖卡</a></figcaption>
        </figure>
      )}
    </section>
  );
}
