import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [dir, type] = process.argv.slice(2);

if (!dir || !type) {
  console.error("usage: node scripts/write-pkg-type.mjs <dir> <type>");
  process.exit(1);
}

const target = join("dist", dir, "package.json");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify({ type }, null, 2)}\n`);
console.log(`wrote ${target} (type=${type})`);
