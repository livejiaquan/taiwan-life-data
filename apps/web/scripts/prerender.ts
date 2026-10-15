/**
 * Post-build: injects the static shell into each page and inlines the (small)
 * stylesheet, so the first paint needs neither JS nor a second request.
 */
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const dist = new URL("../dist/", import.meta.url).pathname;
const ssr = new URL("../dist-ssr/entry-server.js", import.meta.url).href;
const { render } = (await import(ssr)) as { render: (page: "home" | "status") => string };

for (const [page, file] of [["home", "index.html"], ["status", "status/index.html"]] as const) {
  const path = join(dist, file);
  let html = await readFile(path, "utf8");
  if (!html.includes("<!--app-->")) throw new Error(`${file}: missing <!--app--> placeholder`);
  html = html.replace("<!--app-->", render(page));
  for (const match of html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+\.css)"[^>]*>/g)) {
    const css = await readFile(join(dist, match[1]!.replace(/^.*\/assets\//, "assets/")), "utf8");
    html = html.replace(match[0], `<style>${css}</style>`);
  }
  await writeFile(path, html);
  console.log(`prerendered ${file} (${html.length} bytes)`);
}
await rm(new URL("../dist-ssr/", import.meta.url), { recursive: true, force: true });
