import { experimental_useAppPanel } from "@get-bb/plugin-sdk/app";
import { Button, type ButtonProps } from "../ui/button.tsx";
import { REVIEW_CHAT_TAB } from "./review-chat-tab.tsx";

/** Opens the Review chat tab in the page's side panel, or selects it when it is open. */
export function ReviewChatButton({ variant, size }: Pick<ButtonProps, "variant" | "size">) {
  const panel = experimental_useAppPanel();
  return (
    <Button variant={variant} size={size} onClick={() => panel.openTab({ tab: REVIEW_CHAT_TAB })}>
      Review chat
    </Button>
  );
}
