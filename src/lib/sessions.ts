import { promises as fs } from "fs";
import * as path from "path";
import { projectsDir, readDirSafe } from "./platform";

export interface Session {
  id: string; // file name (= the session id passed to --resume)
  file: string;
  cwd: string; // working directory claude ran in (we cd here before launching)
  title: string; // short label: Claude's ai-title, else the first prompt, else a placeholder
  firstPrompt: string; // the prompt that started the session (recall: "what was this about")
  lastPrompt: string; // the most recent user prompt (recall: "where did I leave off")
  lastReply: string; // the last assistant text (recall: "what was the outcome")
  turns: number; // count of user + assistant text messages
  mtime: number;
}

/** Pull the plain text out of a message `content` (string, or an array of parts). */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((p) =>
      p && typeof p === "object" && (p as { type?: string }).type === "text"
        ? ((p as { text?: string }).text ?? "")
        : "",
    )
    .filter(Boolean)
    .join("\n");
}

/** Collapse whitespace and truncate with an ellipsis. */
function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

/** Slash-command expansions and tool wrappers aren't useful recall text; skip them. */
function isWrapper(t: string): boolean {
  return /^<(command-|local-command)/.test(t) || t.startsWith("Caveat:");
}

interface Extracted {
  cwd: string;
  aiTitle: string;
  firstPrompt: string;
  lastPrompt: string;
  lastReply: string;
  turns: number;
}

/**
 * Scan the JSONL for recall material.
 *  - cwd: found near the top, so when `detail` is false we stop as soon as we have it.
 *  - When `detail` is true we read every line, because ai-title / last-prompt / the last
 *    assistant reply are the *latest* occurrences and only the full file is authoritative.
 */
function extract(raw: string, detail: boolean): Extracted {
  const r: Extracted = {
    cwd: "",
    aiTitle: "",
    firstPrompt: "",
    lastPrompt: "",
    lastReply: "",
    turns: 0,
  };
  let lastUser = "";
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!r.cwd && typeof obj.cwd === "string") r.cwd = obj.cwd;
    if (!detail) {
      if (r.cwd) break;
      continue;
    }
    const type = obj.type;
    if (type === "ai-title" && typeof obj.aiTitle === "string") {
      r.aiTitle = obj.aiTitle;
    } else if (type === "last-prompt" && typeof obj.lastPrompt === "string") {
      r.lastPrompt = obj.lastPrompt;
    } else if (type === "user") {
      const text = contentText(
        (obj.message as { content?: unknown } | undefined)?.content,
      ).trim();
      if (text && !isWrapper(text)) {
        r.turns++;
        if (!r.firstPrompt) r.firstPrompt = text;
        lastUser = text;
      }
    } else if (type === "assistant") {
      const text = contentText(
        (obj.message as { content?: unknown } | undefined)?.content,
      ).trim();
      if (text) {
        r.turns++;
        r.lastReply = text;
      }
    }
  }
  // last-prompt entries aren't always present; fall back to the last user message.
  if (!r.lastPrompt) r.lastPrompt = lastUser;
  return r;
}

/**
 * Load sessions newest-first.
 * @param limit max number of sessions to return.
 * @param opts.detail when true, extract recall material (title / prompts / last reply) by
 *   scanning each file fully. Leave false (the default) for callers that only need cwd+mtime.
 */
export async function loadSessions(
  limit = 200,
  opts: { detail?: boolean } = {},
): Promise<Session[]> {
  const detail = opts.detail ?? false;
  const root = await projectsDir();
  const projects = await readDirSafe(root);
  const out: Session[] = [];

  for (const proj of projects) {
    const dir = path.join(root, proj);
    const files = await readDirSafe(dir);
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const file = path.join(dir, f);
      try {
        const stat = await fs.stat(file);
        const raw = await fs.readFile(file, "utf8");
        const e = extract(raw, detail);
        out.push({
          id: path.basename(f, ".jsonl"),
          file,
          cwd: e.cwd || decodeProjectDir(proj),
          title: e.aiTitle || clip(e.firstPrompt, 80) || "(untitled session)",
          firstPrompt: e.firstPrompt,
          lastPrompt: e.lastPrompt,
          lastReply: e.lastReply,
          turns: e.turns,
          mtime: stat.mtimeMs,
        });
      } catch {
        // skip corrupt or unreadable files
      }
    }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, limit);
}

/** Rough reconstruction from a projects dir name (path separators replaced with -). Unused when a cwd was found. */
function decodeProjectDir(name: string): string {
  return name.startsWith("-") ? name.replace(/-/g, "/") : name;
}
