import { rmSync } from "node:fs";

for (const dir of ["dist", "coverage"]) {
  rmSync(dir, { recursive: true, force: true });
}
