// The composer chip for boat Sandbox: `template · environment · size`, and one menu with a group for
// each. Shaped as bb's own Modal chip: a ghost button marked shrinkable, a ChevronDown, a grouped menu.
import { useEffect, type ComponentProps } from "react";
import type { PluginMachineProviderInputsProps } from "@get-bb/plugin-sdk";
import { experimental_Icon as Icon, experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { boatSandboxContract as contract } from "../contract.ts";
import { PRESET_SIZES, PRESETS, type Launch, type LaunchChoices } from "../launch.ts";
import { chipView, pick, type ChipView } from "./chip-report.ts";
import { Menu, MenuContent, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "./ui/menu.tsx";

type LaunchChoicesQuery = ReturnType<typeof experimental_useRpcQuery<typeof contract, "launchChoices">>;

export function LaunchChip({ value, onChange }: PluginMachineProviderInputsProps) {
  const query = experimental_useRpcQuery({ contract, method: "launchChoices", input: {} });
  const view = chipView(value, query);
  const choices = query.data?.status === "ready" ? query.data : null;

  // Reporting to bb is a sync with the host, so it is an effect. bb ignores a report equal to the last
  // one, and the JSON key keeps a new but equal object from reporting again.
  const report = JSON.stringify(view.report);
  useEffect(() => onChange(view.report), [report, onChange]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    // boat changes out of band, so every open reads it again.
    <Menu onOpenChange={(open) => open && void query.refetch()}>
      <MenuTrigger asChild>
        <ChipButton view={view} />
      </MenuTrigger>
      <MenuContent align="start" className="max-h-[min(var(--radix-dropdown-menu-content-available-height),calc(100dvh-0.5rem))] w-max min-w-0 max-w-[min(20rem,calc(100vw-1rem))] overflow-y-auto overscroll-contain">
        {/* Each section above the footer ends with its own separator. */}
        {view.problem !== null && <Problem text={view.problem} />}
        {choices !== null && <LaunchGroups choices={choices} current={view.launch} onPick={(change) => onChange(pick(view.launch, choices, change))} />}
        {query.isLoading && <Loading />}
        <Footer query={query} />
      </MenuContent>
    </Menu>
  );
}

/** The ghost button the menu opens from; radix passes its trigger props and ref through. */
function ChipButton({ view, ...trigger }: { view: ChipView } & ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-promptbox-shrinkable-control=""
      aria-label={`boat sandbox: ${view.label}`}
      className="inline-flex h-8 w-fit min-w-0 max-w-full cursor-pointer items-center justify-start gap-1 whitespace-nowrap rounded-md border-none bg-transparent px-1 text-xs font-medium leading-tight text-muted-foreground shadow-none transition-colors duration-150 hover:bg-state-hover hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-state-active"
      {...trigger}
    >
      {view.problem !== null && <Icon name="AlertTriangle" className="size-3.5 shrink-0 text-warning-text max-md:pointer-coarse:size-5" aria-hidden />}
      <span className="min-w-0 truncate">{view.label}</span>
      <Icon name="ChevronDown" className="size-3.5 shrink-0 text-muted-foreground max-md:pointer-coarse:size-5" aria-hidden />
    </button>
  );
}

function Loading() {
  return (
    <>
      <p className="px-2 py-[0.3125rem] text-xs text-muted-foreground">Reading boat…</p>
      <MenuSeparator />
    </>
  );
}

function Problem({ text }: { text: string }) {
  return (
    <>
      <p className="flex max-w-72 gap-2 px-2 py-[0.3125rem] text-xs leading-snug text-foreground">
        <Icon name="AlertTriangle" className="mt-0.5 size-3.5 shrink-0 text-warning-text" aria-hidden />
        <span>{text}</span>
      </p>
      <MenuSeparator />
    </>
  );
}

/** boat's stock image in the template group; no saved snapshot name has a space. */
const STOCK_IMAGE = "boat stock image";

interface LaunchGroupsProps {
  choices: LaunchChoices;
  /** null when the value is refused: nothing is checked, and every row is a way out. */
  current: Launch | null;
  onPick(change: Partial<Launch>): void;
}

function LaunchGroups({ choices, current, onPick }: LaunchGroupsProps) {
  const { templates, environments, defaults } = choices;
  return (
    <>
      <MenuRadioGroup label="Template" value={current === null ? undefined : (current.template ?? STOCK_IMAGE)}>
        <MenuRadioItem value={STOCK_IMAGE} onSelect={() => onPick({ template: null })}>
          <Row name={STOCK_IMAGE} note={defaults.template === null ? "default" : null} />
        </MenuRadioItem>
        {templates.map((template) => (
          <MenuRadioItem key={template.name} value={template.name} disabled={template.status !== "ready"} onSelect={() => onPick({ template: template.name })}>
            <Row name={template.name} note={templateNote(template.status, template.name === defaults.template)} />
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
      <MenuSeparator />
      <MenuRadioGroup label="Environment" value={current?.environment}>
        {environments.map((environment) => (
          <MenuRadioItem key={environment.name} value={environment.name} onSelect={() => onPick({ environment: environment.name })}>
            <Row name={environment.name} note={environment.isBoatDefault ? "boat default" : null} />
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
      <MenuSeparator />
      <MenuRadioGroup label="Size" value={current?.preset}>
        {PRESETS.map((preset) => (
          <MenuRadioItem key={preset} value={preset} onSelect={() => onPick({ preset })}>
            <Row name={preset} note={PRESET_SIZES[preset]} />
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
      <MenuSeparator />
    </>
  );
}

/** A template that is not ready shows why it is disabled; the settings' default says so. */
function templateNote(status: LaunchChoices["templates"][number]["status"], isDefault: boolean): string | null {
  const notes = [status === "ready" ? null : status, isDefault ? "default" : null].filter((note) => note !== null);
  return notes.length === 0 ? null : notes.join(" · ");
}

function Row({ name, note }: { name: string; note: string | null }) {
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-2">
      <span className="min-w-0 truncate">{name}</span>
      {note !== null && <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{note}</span>}
    </span>
  );
}

function Footer({ query }: { query: LaunchChoicesQuery }) {
  return (
    <>
      <p className="max-w-72 px-2 py-[0.3125rem] text-xs leading-snug text-muted-foreground">
        Save a template on boat:
        <code className="block font-mono">boat snapshot &lt;sandbox-id&gt; &lt;name&gt;</code>
      </p>
      <MenuItem
        onSelect={(event) => {
          // Stay open, so the fresh list shows where the user is looking.
          event.preventDefault();
          void query.refetch();
        }}
      >
        <span>{query.isFetching ? "Reading boat…" : query.error !== null ? "Retry" : "Refresh"}</span>
        <Icon name="RotateCcw" className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </MenuItem>
    </>
  );
}
