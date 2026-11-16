// A draft's editor, under its row: bb's own new-thread composer for the brief, the model and the
// environment, and a plain list for the done-criteria. The composer's send button stores them all;
// Start, back on the row, spawns the crew from what is stored. The edit lives in `session`, outside
// the editor, so it survives a remount or a reload until Save or Cancel ends it; the composer keeps
// the brief under its draft key, but its model and environment picks only while it is mounted.
import {
  experimental_NewThreadComposer as NewThreadComposer,
  experimental_useRpcMutation,
  type NewThreadRequest,
} from "@get-bb/plugin-sdk/app";
import { useState, type Ref } from "react";
import { coordinatorContract as contract, type Draft } from "../../../contract.ts";
import type { CoordinatorId, CrewId } from "../../../model/role.ts";
import { Button } from "../../ui/button.tsx";
import { useHoldEscape } from "../../ui/hold-escape.ts";
import { CriteriaEditor } from "./criteria-editor.tsx";
import { criteriaOf } from "./criteria.ts";
import { composerKeyOf, newerOf, opened, type EditSession, type Newer } from "./edit-session.ts";

type DraftEditorProps = {
  ref: Ref<HTMLDivElement>;
  coordinatorId: CoordinatorId;
  crewId: CrewId;
  /** The draft as read now. */
  draft: Draft;
  session: EditSession;
  onEdit(session: EditSession): void;
  /** Ends the edit: saved, or dropped. */
  onClose(): void;
};

export function DraftEditor({ ref, coordinatorId, crewId, draft, session, onEdit, onClose }: DraftEditorProps) {
  const [failure, setFailure] = useState<string | null>(null);
  const save = experimental_useRpcMutation({ contract, method: "updateDraft" });
  // why seeded from the session's base, not the read: the composer re-seeds every picker when a
  // seed changes, and a draft saved elsewhere must not overwrite the user's picks under them.
  const seed = session.base;
  const newer = newerOf(session, draft);
  // why hold it: bb's Esc leaves the page; the edit would survive, but the user meant no such thing.
  useHoldEscape(true);

  // The composer keeps the brief when this throws, so a failed save loses nothing.
  async function submit(request: NewThreadRequest) {
    setFailure(null);
    const doneCriteria = criteriaOf(session.criteria);
    if (doneCriteria.length === 0) throw fail("A crew needs at least one done-criterion.");
    await save.mutate({ coordinatorId, crewId, request, doneCriteria }).catch((error: unknown) => {
      throw fail(`Could not save it: ${messageOf(error)}`);
    });
    onClose();
  }

  function fail(message: string): Error {
    setFailure(message);
    return new Error(message);
  }

  return (
    <div ref={ref} className="flex flex-col gap-3 pt-2 pb-1">
      {newer !== null && <NewerNotice newer={newer} onTakeNewer={() => onEdit(opened(newer.draft, Date.now()))} />}
      <NewThreadComposer
        // why keyed: taking the saved version opens a new edit, whose brief lives under a new key.
        key={session.openedAt}
        defaultProjectId={seed.projectId}
        defaultProviderId={seed.execution?.providerId}
        defaultModel={seed.execution?.model}
        defaultReasoningLevel={seed.execution?.reasoningLevel}
        defaultServiceTier={seed.execution?.serviceTier}
        // why auto unless picked: a crew works unattended, and a permission prompt would hold it.
        defaultPermissionMode={seed.execution?.permissionMode ?? "auto"}
        defaultEnvironment={seed.environment}
        initialPrompt={seed.brief}
        placeholder="The brief: everything the crew needs to start without asking"
        draftKey={composerKeyOf(coordinatorId, crewId, session)}
        layout="document"
        focusRequest={1}
        onSubmit={submit}
      />
      <CriteriaEditor fields={session.criteria} onChange={(criteria) => onEdit({ ...session, criteria })} />
      {failure !== null && (
        <p role="alert" className="text-xs text-destructive-text">
          {failure}
        </p>
      )}
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * The draft was saved elsewhere (another tab or device) after this edit began. Both stay: the newer
 * one is shown in full here, Save puts this edit over it, and taking the newer one drops this edit.
 */
function NewerNotice({ newer, onTakeNewer }: { newer: Newer; onTakeNewer(): void }) {
  const { draft, changed } = newer;
  return (
    <div role="status" className="flex flex-col gap-2 rounded-md border border-border px-3 py-2 text-sm">
      <p>
        This draft was saved elsewhere since you began editing: its {list(changed)} changed. Save puts your version over it.
      </p>
      <details className="group text-xs">
        <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
          Show the saved version
        </summary>
        <div className="flex flex-col gap-1.5 pt-2">
          <h4 className="font-medium text-muted-foreground">Brief</h4>
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{draft.brief}</p>
          <h4 className="pt-1 font-medium text-muted-foreground">Done when</h4>
          <ol className="flex list-decimal flex-col gap-1 pl-5">
            {draft.doneCriteria.map((criterion, index) => (
              <li key={index} className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                {criterion}
              </li>
            ))}
          </ol>
          <p className="pt-1 text-muted-foreground">Model: {draft.execution?.model ?? "the regional manager's"}</p>
        </div>
      </details>
      {/* why the negative margin: the button's text lines up with the notice's. */}
      <div className="-ml-3">
        <Button variant="ghost" size="sm" onClick={onTakeNewer}>
          Drop mine and edit the saved version
        </Button>
      </div>
    </div>
  );
}

/** "a", "a and b", "a, b and c". */
function list(items: readonly string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
