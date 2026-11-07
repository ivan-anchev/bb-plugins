// The Review chat tab in the PR page's side panel: the review thread of the PR on screen, its whole
// chat live, with a composer. bb's own ThreadChat draws it, so streaming, tool calls, drafts and
// sending are bb's. The tab reads its thread from the page's route rather than from saved params,
// so moving to another PR, or a PR moving to a new review thread, can never leave a stale chat.
import { ThreadChat, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { reviewThreadOf } from "../../contract.ts";
import { usePullRequest } from "../queries.ts";
import { PANEL_ID, parseRoute } from "../routes.ts";
import { Notice } from "../ui/notice.tsx";
import { ReadError } from "../ui/read-error.tsx";

export const REVIEW_CHAT_TAB = { id: "review-chat", context: { kind: "nav-panel", panelId: PANEL_ID }, availability: "action" } as const;

export const reviewChatTab = {
  ...REVIEW_CHAT_TAB,
  title: "Review chat",
  icon: "SideChat",
  component: ReviewChatTab,
  layout: "flush",
  // bb declines to open a tab whose launcher is hidden, so it shows wherever Review chat can.
  useVisible: ({ subPath }: PluginNavPanelProps) => parseRoute(subPath).kind === "pr",
} as const;

function ReviewChatTab({ subPath }: PluginNavPanelProps) {
  const route = parseRoute(subPath);
  if (route.kind !== "pr") return <Notice>Choose a pull request to chat with its review thread.</Notice>;
  // Keyed: a different PR is a different chat.
  return <PrReviewChat key={`${route.projectId}/${route.number}`} projectId={route.projectId} number={route.number} />;
}

// The same read as the PR page, so it shares the page's cache and refreshes with it.
function PrReviewChat({ projectId, number }: { projectId: string; number: number }) {
  const pull = usePullRequest(projectId, number);
  const threadId = pull.data === undefined ? null : reviewThreadOf(pull.data.review);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ReadError read={pull} what="this pull request" />
      {pull.isLoading && <Notice>Loading the review thread…</Notice>}
      {pull.data !== undefined && threadId === null && <Notice>This pull request has no review thread yet. Start review on its page.</Notice>}
      {/* Keyed: a new review thread is a new chat. */}
      {threadId !== null && <ThreadChat key={threadId} threadId={threadId} variant="compact" layout="contained" permissionPolicy="editable" className="min-h-0 flex-1" />}
    </div>
  );
}
