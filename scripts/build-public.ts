import { spawnSync } from "node:child_process";
import { assertPublicArtifacts, assertPublicBuildEnv } from "./public-safety";

assertPublicBuildEnv(process.env);
const result = spawnSync("npm", ["run", "build"], { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
const checked = await assertPublicArtifacts("apps/web/dist");
console.log(`Public artifacts checked (${checked} files): no credential markers or key-requiring API URLs.`);
