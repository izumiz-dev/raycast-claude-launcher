import { useEffect, useState } from "react";
import {
  Action,
  ActionPanel,
  Clipboard,
  closeMainWindow,
  Icon,
  List,
  showToast,
  Toast,
} from "@raycast/api";
import { buildCommand, launchInteractive } from "./lib/platform";
import { loadSessions, Session } from "./lib/sessions";

/**
 * List Session History (merges the old Search Sessions and Resume Last).
 * Sorted newest first, so the top row is the most recent session; pressing Enter
 * to resume it doubles as "resume last".
 */
export default function ListSessions() {
  const [items, setItems] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSessions()
      .then(setItems)
      .finally(() => setLoading(false));
  }, []);

  async function resume(s: Session) {
    try {
      await closeMainWindow();
      await launchInteractive(s.cwd, ["-r", s.id]); // primary action: jump into the session
    } catch {
      // fall back to copying where we can't launch
      const cmd = buildCommand(["-r", s.id], s.cwd);
      await Clipboard.copy(cmd);
      await showToast({
        style: Toast.Style.Failure,
        title: "Couldn't launch — command copied to clipboard",
        message: cmd,
      });
    }
  }

  return (
    <List
      isLoading={loading}
      searchBarPlaceholder="Search sessions by summary, path, or ID"
      isShowingDetail
    >
      {items.map((s) => {
        const resumeCmd = buildCommand(["-r", s.id], s.cwd);
        return (
          <List.Item
            key={s.file}
            title={s.summary}
            subtitle={s.cwd}
            keywords={[s.id, s.cwd]}
            accessories={[{ date: new Date(s.mtime) }]}
            detail={
              <List.Item.Detail
                markdown={`### Resume command\n\n\`\`\`bash\n${resumeCmd}\n\`\`\`\n\n**Session ID**: \`${s.id}\`\n\n**Directory**: \`${s.cwd}\``}
              />
            }
            actions={
              <ActionPanel>
                <Action
                  title="Resume Session"
                  icon={Icon.Terminal}
                  onAction={() => resume(s)}
                />
                <Action.CopyToClipboard
                  title="Copy Resume Command"
                  content={resumeCmd}
                />
                <Action.CopyToClipboard
                  title="Copy Session ID"
                  content={s.id}
                />
                <Action.CopyToClipboard
                  title="Copy Directory Path"
                  content={s.cwd}
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
