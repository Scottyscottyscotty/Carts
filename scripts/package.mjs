// Zips dist/ into release/commander-cart-tagger-v<version>.zip (needs the `zip` CLI, present on macOS/Linux).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
mkdirSync("release", { recursive: true });
const out = `../release/commander-cart-tagger-v${version}.zip`;
execFileSync("zip", ["-r", "-q", "-X", out, "."], { cwd: "dist", stdio: "inherit" });
console.log(`release/commander-cart-tagger-v${version}.zip`);
