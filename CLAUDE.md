# CLAUDE.md

Guidance for Claude Code when working in this directory (`raycast-claude-launcher/`).

## What this is

A Raycast extension that turns Raycast into the **front door to Claude Code sessions**.
The primary action everywhere is **launch into an interactive `claude` session**; copying a
command is only the fallback. That is the governing concept.

Two hard constraints shape every decision:

1. **Stay on the flat-rate path.** Only launch *interactive* `claude`. Never use `-p` /
   stream-json / the Agent SDK / ACP — those are metered. Reading files under
   `~/.claude` is free; do that for anything informational.
2. **No extra binaries.** The `claude` CLI on PATH is the only hard dependency.

## Layout

```
src/
  list-sessions.tsx   List/search session history → resume (primary) / copy (fallback)
  open-project.tsx    Pick a recent project → start claude there (new / --continue)
  skills-agents.tsx   Browse/preview ~/.claude/skills and agents (read-only)
  lib/
    platform.ts       Path resolution, command building, launchInteractive() — the core
    sessions.ts       Read & parse the project JSONL into Session[]
scripts/
  clean.mjs           OS-independent node_modules/lockfile cleanup (pwsh-safe)
  sync-to-windows.sh  rsync WSL → Windows (for dev on the Windows-native Raycast)
mise.toml             Pinned toolchain (node/pnpm) + all build tasks
```

`lib/platform.ts` is the heart: `launchInteractive(cwd, extra)` opens the user's real login
shell (mac: Terminal via `osascript`; Windows: `wt + wsl` with the login shell + `-lic`) so
the full dev environment (mise → node/npx, needed for MCP servers) is reproduced. It throws on
failure so callers fall back to copying via `buildCommand()`.

## Conventions

- **All UI text and code comments are in English.** Keep it that way — do not introduce Japanese.
- TypeScript only (Raycast requirement). React with `useEffect`/`useState`.
- Pins matter: `@types/react` 19.0.10 and `@types/node` 22.19.17 are exact-pinned via
  `pnpm.overrides` to avoid the TS2786 bigint error against @raycast/api's React 19. Don't loosen them.
- Be careful with quotes in `Action`/label strings — an autocapitalizer can rewrite words on
  `ray lint --fix`; avoid inner double-quotes in titles.
- **No `menu-bar` commands.** Raycast for Windows doesn't support them, and this extension
  targets Windows(WSL). Surface resident info as a `view` command instead.
- **Self-contained features only.** A user who installs only this extension must get the full
  feature. Don't depend on any external tool or its files (e.g. a third-party statusline).

## Build / dev

Run tasks through mise (the toolchain is pinned):

```bash
mise run build     # ray build -e dist (includes type check) — the fast local verify
mise run lint      # ray lint (ESLint + Prettier)
mise run sync      # rsync to the Windows side (mise run sync-watch to keep watching)
```

`ray develop` only runs on the **same OS as the Raycast app**, and `node_modules` is per-OS
(native esbuild). So: edit on WSL, `mise run build` to verify, `mise run sync` to Windows, then
`npm install` + `npm run dev` on the Windows side for the real hot-reload loop. Always run
`mise run build` and `mise run lint` before committing.
