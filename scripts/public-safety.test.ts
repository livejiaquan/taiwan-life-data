import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertPublicArtifacts, assertPublicBuildEnv } from "./public-safety";

describe("public build safety", () => {
  it("refuses to build with credentials in the environment", () => {
    expect(() => assertPublicBuildEnv({ MOENV_API_KEY: "x" })).toThrow(/MOENV_API_KEY/);
    expect(() => assertPublicBuildEnv({})).not.toThrow();
  });

  it("flags key-bearing URLs anywhere in the output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tld-"));
    await mkdir(join(dir, "data"));
    await writeFile(join(dir, "index.html"), "<p>ok https://cwaopendata.s3.ap-northeast-1.amazonaws.com/x.json</p>");
    await writeFile(join(dir, "app.js"), 'const markers=/api[_-]?key=|Authorization=|CWA-[0-9a-f]{8}-/i;');
    await expect(assertPublicArtifacts(dir)).resolves.toBe(2);
    await writeFile(join(dir, "data", "aqi.json"), '{"u":"https://data.moenv.gov.tw/api/v2/aqx_p_432?api_key=abc"}');
    await expect(assertPublicArtifacts(dir)).rejects.toThrow(/aqi\.json/);
    await writeFile(join(dir, "data", "aqi.json"), "{}");
    await writeFile(join(dir, "cwa.js"), 'fetch("x?Authorization=CWA-1234ABCD-1234-1234-1234-1234567890AB")');
    await expect(assertPublicArtifacts(dir)).rejects.toThrow(/cwa\.js/);
  });
});
