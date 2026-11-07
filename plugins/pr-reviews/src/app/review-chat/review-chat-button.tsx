import { experimental_useAppPanel } from "@get-bb/plugin-sdk/app";
import { Button, type ButtonProps } from "../ui/button.tsx";
import { IconButton } from "../ui/icon-button.tsx";
import { REVIEW_CHAT_TAB } from "./review-chat-tab.tsx";

/** Opens the Review chat tab in the page's side panel, or selects it when it is open. */
export function ReviewChatButton({ variant }: Pick<ButtonProps, "variant">) {
  const openReviewChat = useOpenReviewChat();
  return (
    <Button variant={variant} onClick={openReviewChat}>
      Review chat
    </Button>
  );
}

/** The same action as an icon, for the PR header. */
export function ReviewChatIconButton() {
  const openReviewChat = useOpenReviewChat();
  return <IconButton icon="SideChat" label="Review chat" onClick={openReviewChat} />;
}

function useOpenReviewChat(): () => void {
  const panel = experimental_useAppPanel();
  return () => panel.openTab({ tab: REVIEW_CHAT_TAB });
}
