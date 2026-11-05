// The provider icon on a disc, with a status dot bottom-right cut out by a ring
// in the surface colour. Status never replaces the icon.
import { experimental_ProviderIcon as ProviderIcon, experimental_useProviders } from "@get-bb/plugin-sdk/app";
import type { Delegate } from "../delegate.ts";
import { statusWord } from "../roster.ts";
import { RollingNumber, StatusDot } from "./Motion.tsx";

const STACK_LIMIT = 3;

/** Overlapped avatars of the most recent three delegates, then a "+N" chip. */
export function AvatarStack({ delegates }: { delegates: readonly Delegate[] }) {
  const shown = delegates.slice(-STACK_LIMIT);
  const extra = delegates.length - shown.length;
  return (
    <span className="sr-stack" aria-hidden>
      {shown.map((d) => <Avatar key={d.id} delegate={d} />)}
      {extra > 0 && <span className="sr-av sr-more">+<RollingNumber value={extra} /></span>}
    </span>
  );
}

/** The delegate's own provider: a Codex child under a Claude Code thread shows the Codex icon. */
export function Avatar({ delegate: d }: { delegate: Delegate }) {
  const provider = useProviderRecord(d.providerId);
  const { status } = d.state;
  return (
    <span className="sr-av">
      <ProviderIcon providerKind="agent" provider={provider} fallback="UserRound" className="sr-av-icon" aria-hidden />
      <StatusDot status={status} />
      {/* why: colour never carries state alone (R9). */}
      <span className="sr-status-word">{statusWord(status)}</span>
    </span>
  );
}

// ---------------------------------------------------------------- layer 2

/** bb's cached provider record; an id-only record still resolves registered artwork. */
function useProviderRecord(providerId: string) {
  const { providers } = experimental_useProviders();
  return providers.find((p) => p.id === providerId) ?? { id: providerId };
}
