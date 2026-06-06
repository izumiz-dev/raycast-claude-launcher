// Remove node_modules and lockfiles (OS-independent).
// Invoked from a mise task as `node scripts/clean.mjs`. Inline `-e` quoting breaks
// under PowerShell, so this always runs as a script file.
import { rmSync } from "node:fs";

for (const p of ["node_modules", "pnpm-lock.yaml", "package-lock.json"]) {
  rmSync(p, { recursive: true, force: true });
}
console.log("cleaned: node_modules / lockfiles");
