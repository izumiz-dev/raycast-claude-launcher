// Remove node_modules (OS-independent), plus a stray package-lock.json if an
// accidental `npm install` left one — both platforms use mise + pnpm.
// pnpm-lock.yaml is kept: it is the dependency pin and must survive a reset.
// Invoked from a mise task as `node scripts/clean.mjs`. Inline `-e` quoting breaks
// under PowerShell, so this always runs as a script file.
import { rmSync } from "node:fs";

for (const p of ["node_modules", "package-lock.json"]) {
  rmSync(p, { recursive: true, force: true });
}
console.log("cleaned: node_modules (kept pnpm-lock.yaml)");
