/**
 * Path resolution, command building, and "launch into an interactive session".
 *
 * Concept (see docs/raycast-claude-code/07):
 *  - The launcher's job is to take you there. The primary action launches; copy is the fallback.
 *  - We launch interactive claude (the flat-rate path). We never use -p (avoids metered billing).
 *  - OS differences are confined to "how the terminal is opened" (mac: Terminal / Windows: wt + wsl).
 */
import { execFile } from "child_process";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { getPreferenceValues } from "@raycast/api";

interface Prefs {
  claudeHome?: string;
  claudeBin?: string;
  wslDistro?: string;
}

export const isWindows = process.platform === "win32";
export const isMac = process.platform === "darwin";

export function prefs(): Prefs {
  return getPreferenceValues<Prefs>();
}

export function claudeHome(): string {
  const p = prefs().claudeHome?.trim();
  if (p) return p;
  if (isWindows) {
    const distro = prefs().wslDistro?.trim() || "Ubuntu";
    return `\\\\wsl.localhost\\${distro}\\home\\${os.userInfo().username}\\.claude`;
  }
  return path.join(os.homedir(), ".claude");
}

export const projectsDir = () => path.join(claudeHome(), "projects");
export const skillsDir = () => path.join(claudeHome(), "skills");
export const agentsDir = () => path.join(claudeHome(), "agents");

export const claudeBin = () => prefs().claudeBin?.trim() || "claude";

export function shArg(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** For the copy fallback. `cd <cwd> && claude <extra...>` */
export function buildCommand(extra: string[], cwd?: string): string {
  const body = `${claudeBin()}${extra.length ? " " + extra.map(shArg).join(" ") : ""}`;
  return cwd ? `cd ${shArg(cwd)} && ${body}` : body;
}

export async function readDirSafe(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

function run(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: false }, (err) =>
      err ? reject(err) : resolve(),
    );
  });
}

/**
 * Actually launch an interactive claude session (the primary action).
 * Throws on failure, so the caller can fall back to copying.
 * @param cwd   launch directory (the cwd from the session JSONL; mac=native / Windows=a WSL Linux path)
 * @param extra args for claude (e.g. ["-r", "<id>"] / ["--continue"] / ['"prompt"'])
 */
export async function launchInteractive(
  cwd: string | undefined,
  extra: string[] = [],
): Promise<void> {
  const inner = `${claudeBin()}${extra.length ? " " + extra.map(shArg).join(" ") : ""}`;
  // cd to cwd → launch claude → exec the user's shell so the window stays open.
  const bodyFor = (shell: string) =>
    `${cwd ? `cd ${shArg(cwd)} && ` : ""}${inner}\nexec ${shArg(shell)}\n`;

  if (isWindows) {
    const distro = prefs().wslDistro?.trim() || "Ubuntu";
    // Open in the user's login shell (zsh/bash/fish/etc). Tools like node/npx are
    // enabled via mise in that shell's rc (.zshrc etc), so hardcoding bash would
    // leave MCP's npx and friends missing. Using the login shell reproduces "the
    // same environment as the user's everyday terminal".
    const shell = await wslLoginShell(distro);
    const winTmp = path.join(os.tmpdir(), `raycast-claude-${Date.now()}.sh`);
    await fs.writeFile(winTmp, bodyFor(shell), { encoding: "utf8" });
    const wslPath = winToWslPath(winTmp);
    // <shell> -lic = login + interactive init → .zprofile/.zshrc etc are read and
    // mise (node/npx) is loaded. We only pass `source <path>`, so there's no ; and
    // wt doesn't spawn extra tabs.
    const sourceCmd = `source ${shArg(wslPath)}`;
    try {
      await run("wt.exe", [
        "-w",
        "0",
        "wsl.exe",
        "-d",
        distro,
        "--",
        shell,
        "-lic",
        sourceCmd,
      ]);
    } catch {
      await run("wsl.exe", ["-d", distro, "--", shell, "-lic", sourceCmd]);
    }
    return;
  }

  // macOS: use Terminal's `do script` to open in the user's shell.
  // Terminal starts a login interactive shell by default, so mise and the rest are set up.
  const shell = process.env.SHELL || "/bin/zsh";
  const tmp = path.join(os.tmpdir(), `raycast-claude-${Date.now()}.sh`);
  await fs.writeFile(tmp, bodyFor(shell), { mode: 0o755 });
  await run("osascript", [
    "-e",
    'tell application "Terminal" to activate',
    "-e",
    `tell application "Terminal" to do script "source ${tmp}"`,
  ]);
}

/** C:\\Users\\..\\Temp\\x.sh → /mnt/c/Users/../Temp/x.sh (for access from WSL) */
function winToWslPath(p: string): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (!m) return p.replace(/\\/g, "/");
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}`;
}

function runCapture(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { windowsHide: true, encoding: "utf8" },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

/** Get the WSL user's login shell (the shell field in /etc/passwd). Falls back to bash. */
async function wslLoginShell(distro: string): Promise<string> {
  try {
    const out = await runCapture("wsl.exe", [
      "-d",
      distro,
      "--",
      "sh",
      "-c",
      "getent passwd $(id -u) | cut -d: -f7",
    ]);
    const sh = out.trim().split("\n").pop()?.trim();
    if (sh && sh.startsWith("/")) return sh;
  } catch {
    // ignore → fall back to bash
  }
  return "bash";
}
