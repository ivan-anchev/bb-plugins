// homepageSection: one of the sidebar's sections as a card under the new-thread composer, Needs my
// review unless the reader switches it from the title's menu. The three PRs it lists first, each
// ending in a state badge, its author's avatar carrying the sidebar's attention dot, and how many
// it lists in all; a row opens the PR's page. It reads the sidebar's own `inbox` and `visits`, so
// the two agree.
import { experimental_Icon as Icon, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { prsOf, SECTION_KEYS, type InboxPr, type Section, type SectionKey } from "../../contract.ts";
import { STATE_TILES } from "../page/pr-header.tsx";
import { useInbox, useVisits } from "../queries.ts";
import { timeAgo } from "../relative-time.ts";
import { PANEL_PATH, routeSubPath } from "../routes.ts";
import { attentionOf, visitsByPr, type Visits } from "../sidebar/attention.ts";
import { AttentionAvatar, attentionLabel } from "../sidebar/pr-row.tsx";
import { SECTION_TEXT } from "../sidebar/section-text.ts";
import { Menu, MenuContent, MenuCountedLabel, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu.tsx";
import { ReadError } from "../ui/read-error.tsx";
import { useRememberedState } from "../use-remembered-state.ts";

const SHOWN = 3;

// The section the card shows, kept for the session.
const shownSection = new Map<string, SectionKey>();

export function PrCard() {
  const inbox = useInbox();
  const visits = visitsByPr(useVisits().data?.visits ?? []);
  const [key, setKey] = useRememberedState(shownSection, "card", "review");
  const sections = inbox.data?.sections ?? [];
  const section = sections.find((s) => s.key === key);
  // A stack lists its stack-mates from other sections too; the card shows only the section's own PRs.
  const prs = section === undefined ? [] : prsOf(section).filter((pr) => pr.section === key);

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl bg-(--card) px-4 py-3.5 text-[13px] leading-[18px] text-foreground shadow-[0_0_0_1px_var(--border)]">
      <div className="flex items-center gap-1.5">
        <SectionSwitcher current={key} sections={sections} onChange={setKey} />
        {section !== undefined && section.count > 0 && (
          <span className="ml-auto rounded-full bg-foreground/8 px-1.5 text-xs leading-[18px] text-muted-foreground tabular-nums">{section.count}</span>
        )}
      </div>
      <ReadError read={inbox} what="pull requests" />
      {prs.length > 0 ? (
        <ul className="-mx-2 -my-1 flex flex-col gap-0.5">
          {prs.slice(0, SHOWN).map((pr) => (
            <li key={`${pr.repo}#${pr.number}`}>
              <Row pr={pr} section={key} visits={visits} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs leading-4 text-muted-foreground">{inbox.isLoading ? "Loading pull requests…" : SECTION_TEXT[key].empty}</p>
      )}
    </div>
  );
}

// The card's title is the menu's trigger: the section's name and a chevron.
function SectionSwitcher({ current, sections, onChange }: { current: SectionKey; sections: readonly Section[]; onChange(key: SectionKey): void }) {
  const countOf = (key: SectionKey) => sections.find((s) => s.key === key)?.count ?? 0;
  return (
    <Menu>
      <MenuTrigger className="-mx-1.5 -my-0.5 flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 font-medium transition-colors duration-150 hover:bg-state-hover hover:duration-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=open]:bg-state-active">
        <Icon name="GitPullRequest" className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        {SECTION_TEXT[current].title}
        <Icon name="ChevronDown" className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </MenuTrigger>
      <MenuContent align="start" className="min-w-48">
        <MenuRadioGroup value={current} onValueChange={(value) => onChange(SECTION_KEYS.find((key) => key === value) ?? current)}>
          {SECTION_KEYS.map((key) => (
            <MenuRadioItem key={key} value={key}>
              <MenuCountedLabel label={SECTION_TEXT[key].title} count={countOf(key)} />
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

function Row({ pr, section, visits }: { pr: InboxPr; section: SectionKey; visits: Visits }) {
  const navigate = useBbNavigate();
  const open = () => navigate.toPluginPanel(PANEL_PATH, { subPath: routeSubPath({ kind: "pr", projectId: pr.projectId, number: pr.number }) });
  const attention = attentionOf(pr, section, visits);
  const state = STATE_TILES[pr.state];
  // A merged PR's age is since it merged, as Recently merged sorts it.
  const age = timeAgo(pr.mergedAt ?? pr.updatedAt, Date.now());
  return (
    <button
      type="button"
      onClick={open}
      className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-state-hover hover:duration-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span className="truncate">{pr.title}</span>
      <span className={`inline-flex items-center gap-1 rounded-md bg-[color-mix(in_oklab,currentColor_12%,transparent)] px-1.5 text-[11px] leading-[18px] font-medium tabular-nums ${state.color}`}>
        <Icon name={state.icon} className="size-3 shrink-0" aria-hidden />
        {pr.number}
      </span>
      <span className="col-span-2 flex min-w-0 items-center gap-1 text-xs leading-4 whitespace-nowrap text-muted-foreground">
        <span className="truncate">{pr.repo}</span>
        <span aria-hidden>·</span>
        <AttentionAvatar login={pr.author} attention={attention} ring="ring-(--card)" />
        <span className="truncate">{pr.author}</span>
        <span aria-hidden>·</span>
        <span className="shrink-0">{age}</span>
      </span>
      <span className="sr-only">, {[state.label, attention === null ? null : attentionLabel(attention)].filter((word) => word !== null).join(", ")}</span>
    </button>
  );
}
