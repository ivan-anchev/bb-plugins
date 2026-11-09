// Claude Code, Codex and the AI proxy for one boat environment, for `bb boat status`. The environment's
// toggles decide whether agent sign-ins go in; the credential profile it uses holds them. The plugin
// only reads these: changing them is the user's call on boat.
import type { Account, CredentialProfile, SandboxEnvironment } from "./boat/wire.ts";
import type { Read } from "./settle.ts";
import { shellQuote } from "./shell.ts";

interface Agent {
  name: string;
  /** The credential ids in a boat profile that sign this agent in. */
  credentials: readonly string[];
  connect: string;
}

const AGENTS_PAGE = "https://boat.dev/dashboard?tab=agents";

const AGENTS: readonly Agent[] = [
  {
    name: "Claude Code",
    credentials: ["claude-subscription", "anthropic-api-key", "claude-bedrock"],
    connect: `Sign in to Claude, or add an Anthropic API key, on ${AGENTS_PAGE}`,
  },
  {
    name: "Codex",
    credentials: ["chatgpt-subscription", "openai-api-key", "codex-bedrock"],
    connect: `Sign in to ChatGPT, or add an OpenAI API key, on ${AGENTS_PAGE}`,
  },
];

/** The rows a failed environment read leaves unknown. */
export const SIGN_IN_ROWS = [...AGENTS.map((agent) => agent.name), "AI proxy"] as const;

/** One row per agent, each gap with a `Fix:` line. */
export function agentLines(environment: SandboxEnvironment, account: Account, profiles: Read<CredentialProfile[]>): string[] {
  const profile = profileOf(environment, account, profiles);
  return AGENTS.flatMap((agent) => {
    // Safe for third parties withholds the real keys, but proxyAiCredentials still passes boat's proxy
    // placeholders (OAS `SandboxEnvironment.proxyAiCredentials`), so the agent does sign in.
    if (environment.withholdsAll && environment.proxiesAi)
      return [`${agent.name}: through boat's AI proxy (environment ${environment.name} passes placeholders)`];
    if (environment.withholdsAll || !environment.passes.agents)
      return [
        `${agent.name}: withheld (environment ${environment.name} does not pass agent credentials)`,
        `Fix: Run \`${enableAgentsCommand(environment)}\``,
      ];
    if (!profile.ok) return [`${agent.name}: unknown (${profile.reason})`];
    const credential = profile.value.connected.find((id) => agent.credentials.includes(id));
    return credential === undefined
      ? [`${agent.name}: not connected on boat`, `Fix: ${agent.connect}`]
      : [`${agent.name}: connected on boat (${credential})`];
  });
}

/** The account's setting as it is; the skill explains the trade-off. */
export function proxyLine(environment: SandboxEnvironment, account: Account, profiles: Read<CredentialProfile[]>): string {
  const profile = profileOf(environment, account, profiles);
  if (!profile.ok) return `AI proxy: unknown (${profile.reason})`;
  return profile.value.proxyOn
    ? "AI proxy: on for your boat account ($1 a day plus $1 per 1,000 requests)"
    : "AI proxy: off for your boat account";
}

/** The profile the environment uses; null names the sandbox owner's default: the key's account, which creates thread sandboxes. */
function profileOf(environment: SandboxEnvironment, account: Account, profiles: Read<CredentialProfile[]>): Read<CredentialProfile> {
  if (!profiles.ok) return profiles;
  const profile = environment.profileId === null
    ? profiles.value.find((candidate) => candidate.isDefault && candidate.ownerId === account.id)
    : profiles.value.find((candidate) => candidate.id === environment.profileId);
  return profile === undefined
    ? { ok: false, reason: `boat lists no credential profile for environment ${environment.name}` }
    : { ok: true, value: profile };
}

/** `boat env set` with agent credentials on, and safe-for-third-parties off when it overrides them. Names are free text. */
const enableAgentsCommand = (environment: SandboxEnvironment): string =>
  `boat env set ${shellQuote(environment.name)}${environment.withholdsAll ? " --safe-for-third-parties false" : ""} --agents-credentials true`;
