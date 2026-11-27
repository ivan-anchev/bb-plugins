// Whether the regional manager's done handoffs are verified, at the top right of its Board: a chip
// naming the state, quiet while they are and amber while they aren't, that opens a menu holding the
// switch and a line on what the state means (BBP-152's Status chip). bb's host shims Radix, so the
// menu shares its overlay layer (focus, dismiss, Escape back to the chip), as Activity Sidebar's does.
import { experimental_Icon as Icon, experimental_useRpcMutation } from "@get-bb/plugin-sdk/app";
import { Content, Root, Trigger } from "@radix-ui/react-popover";
import { useState } from "react";
import { coordinatorContract as contract } from "../../../contract.ts";
import type { CoordinatorId } from "../../../model/role.ts";
import { Switch } from "../../ui/switch.tsx";
import "./verify-chip.css";

const ON_MEANS = "A reviewer, then a verifier, check each new done handoff before the regional manager hears of it.";
const OFF_MEANS = "New done handoffs skip review and verification.";

export function VerifyChip({ coordinatorId, verify }: { coordinatorId: CoordinatorId; verify: boolean }) {
  const { shown, pending, failure, change } = useVerifySave(coordinatorId, verify);
  return (
    <div className="rmi-verify-bar">
      <Root>
        <Trigger
          className="rmi-verify-chip"
          aria-label={shown ? `Verification on. ${ON_MEANS}` : `Verification off. ${OFF_MEANS}`}
          aria-disabled={pending}
          data-off={!shown || undefined}
        >
          {shown ? <ShieldCheck /> : <Icon name="AlertTriangle" aria-hidden className="text-warning-text" />}
          {shown ? "Verification on" : "Verification off"}
          <Icon name="ChevronDown" aria-hidden className="rmi-verify-chevron" />
        </Trigger>
        <Content className="rmi-verify-menu" aria-label="Verification" align="end" sideOffset={4} collisionPadding={8}>
          <Switch checked={shown} onChange={change} pending={pending} label="Verify done handoffs" hint={shown ? ON_MEANS : OFF_MEANS} />
          {failure !== null && (
            <p role="alert" className="rmi-verify-error">
              {failure}
            </p>
          )}
        </Content>
      </Root>
    </div>
  );
}

// ------------------------------------------------------------------ layer 2

/**
 * Saving the switch: it shows what the user asked for while the change saves, and the stored value
 * once the board reads it back or the save fails, with the failure until the next change.
 */
function useVerifySave(coordinatorId: CoordinatorId, verify: boolean) {
  const save = experimental_useRpcMutation({ contract, method: "setVerify" });
  const [asked, setAsked] = useState<boolean | null>(null);
  // why during render: once the board reads back what was asked, the stored value takes over.
  if (asked !== null && asked === verify) setAsked(null);

  function change(next: boolean) {
    setAsked(next);
    save.mutate({ coordinatorId, verify: next }).catch(() => setAsked(null));
  }

  return {
    shown: asked ?? verify,
    pending: save.isPending,
    // why the opposite of the stored value: a failed save leaves the stored one, which it tried to change.
    failure: save.error === null ? null : `Couldn't turn verification ${verify ? "off" : "on"}: ${save.error.message}`,
    change,
  };
}

/** The on state's glyph, a shield with a check, in the stroke of bb's icons. */
function ShieldCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
