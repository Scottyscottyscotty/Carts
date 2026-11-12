import { build, context } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const watch = process.argv.includes("--watch");
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

const opts = {
  entryPoints: {
    background: "src/background/service-worker.ts",
    sidepanel: "src/sidepanel/panel.ts",
    content: "src/content/index.ts",
  },
  outdir: "dist",
  bundle: true,
  format: "esm",
  target: "chrome114",
  sourcemap: true,
};

function copyStatic() {
  cpSync("manifest.json", "dist/manifest.json");
  cpSync("src/sidepanel/index.html", "dist/sidepanel.html");
  cpSync("src/sidepanel/styles.css", "dist/styles.css");
  cpSync("src/content/styles.css", "dist/content.css");
  cpSync("icons", "dist/icons", { recursive: true });
}

copyStatic();
if (watch) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log("watching…");
} else {
  await build(opts);
  console.log("built → dist/");
}
