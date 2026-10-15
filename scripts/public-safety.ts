import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** Ported from taiwan-uv-heat-dashboard: keys belong to the collect step only. */
export const assertPublicBuildEnv = (env: NodeJS.ProcessEnv) => {
  const leaked = ["MOENV_API_KEY", "CWA_API_KEY", "VITE_MOENV_API_KEY", "VITE_CWA_API_KEY"].filter((name) => env[name]);
  if (leaked.length) throw new Error(`Credentials must never reach the public build: ${leaked.join(", ")}`);
};

const FORBIDDEN = [
  /CWA-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i,
  // A key-shaped value after the parameter name (the bare word may appear in validation code).
  /api[_-]?key=[0-9a-z-]{8,}/i,
  /Authorization(?:=|%3D)[0-9a-z-]{8,}/i,
  /opendata\.cwa\.gov\.tw\/api\//i,
  /data\.moenv\.gov\.tw\/api\//i,
];

/** Throws if any public file contains a credential marker or a key-requiring API URL. */
export const assertPublicArtifacts = async (dir: string): Promise<number> => {
  let checked = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) checked += await assertPublicArtifacts(path);
    else if (/\.(js|json|html|css|map|txt)$/.test(entry.name)) {
      const content = await readFile(path, "utf8");
      const hit = FORBIDDEN.find((pattern) => pattern.test(content));
      if (hit) throw new Error(`Public artifact safety check failed: ${path} matches ${hit}`);
      checked += 1;
    }
  }
  return checked;
};
