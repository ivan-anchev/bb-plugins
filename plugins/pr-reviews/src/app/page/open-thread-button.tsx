import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { Button, type ButtonProps } from "../ui/button.tsx";

type OpenThreadButtonProps = { threadId: string } & Pick<ButtonProps, "variant" | "size">;

/** Goes to the PR's review thread. */
export function OpenThreadButton({ threadId, variant, size }: OpenThreadButtonProps) {
  const navigate = useBbNavigate();
  return (
    <Button variant={variant} size={size} onClick={() => navigate.toThread(threadId)}>
      Open thread
    </Button>
  );
}
