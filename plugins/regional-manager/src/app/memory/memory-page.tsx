// The Memory page: one regional manager's memory folder, its files, and an editor for the one
// picked. It keeps each file's edit, so switching files, bb redrawing the panel or a reload loses
// nothing and a save still settles, and while any draft is open, Esc never leaves the page.
import { experimental_Icon as Icon, experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import type { Ref } from "react";
import { coordinatorContract as contract } from "../../contract.ts";
import { memoryFileSchema, type MemoryFile } from "../../model/memory-file.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { Button } from "../ui/button.tsx";
import { useHoldEscape } from "../ui/hold-escape.ts";
import { ReadFailure } from "../ui/read-failure.tsx";
import { useStored } from "../ui/stored.ts";
import { useProfile } from "../profile/use-profile.ts";
import { MemoryEditor } from "./memory-editor.tsx";
import { useFileEdits } from "./use-file-edits.ts";

type MemoryPageProps = { ref: Ref<HTMLDivElement>; coordinatorId: CoordinatorId; onBack(): void };

export function MemoryPage({ ref, coordinatorId, onBack }: MemoryPageProps) {
  const list = experimental_useRpcQuery({ contract, method: "memoryList", input: { coordinatorId } });
  const title = useProfile(coordinatorId)?.name ?? null;
  // why session storage: the file this tab has open survives bb redrawing the panel and a reload, as its draft does.
  const picked = useStored(sessionStorage, pickedKeyOf(coordinatorId), memoryFileSchema);
  const edits = useFileEdits(coordinatorId);
  const files = list.data?.files ?? [];
  const drafted = new Set(files.filter((listed) => edits.of(listed).draft !== null));
  useHoldEscape(drafted.size > 0);

  // why derived: until the user picks a listed file, the open file follows the list's first file.
  const file = files.find((listed) => listed === picked.value) ?? files[0] ?? null;

  return (
    // why the tab stop: the page scrolls, and the keyboard scrolls only what has focus (REVIEW.md).
    <div ref={ref} tabIndex={0} className="h-full min-h-0 overflow-y-auto bg-background text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset">
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-4 px-4 py-6 sm:px-6">
        <header className="flex flex-col items-start gap-1">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <Icon name="ArrowLeft" aria-hidden />
            All
          </Button>
          <div className="flex min-w-0 flex-col gap-0.5 px-3">
            <h1 className="text-base font-medium text-pretty">Memory{title !== null && <span className="text-muted-foreground"> · {title}</span>}</h1>
            {list.data !== undefined && (
              <p className="text-xs text-muted-foreground">
                Files on the bb server, in <code className="font-mono break-all select-all">{list.data.dir}</code>
              </p>
            )}
          </div>
        </header>
        {list.error !== null && <ReadFailure onRetry={() => void list.refetch()}>Could not read the memory folder: {list.error.message}</ReadFailure>}
        {list.data !== undefined && file === null && <p className="px-3 text-sm text-muted-foreground">The memory folder has no files.</p>}
        {list.data !== undefined && file !== null && (
          <div className="flex flex-1 flex-col gap-4 md:flex-row">
            <FileList files={list.data.files} open={file} drafted={drafted} onOpen={picked.store} />
            <MemoryEditor
              key={file}
              coordinatorId={coordinatorId}
              file={file}
              edit={edits.of(file)}
              onDraft={(draft) => edits.setDraft(file, draft)}
              onSave={(save) => edits.save(file, save)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** Where a tab keeps the file it has open on a regional manager's Memory page. */
const pickedKeyOf = (coordinatorId: CoordinatorId): string => `coordinator-memory-open:${coordinatorId}`;

function FileList({ files, open, drafted, onOpen }: { files: readonly MemoryFile[]; open: MemoryFile; drafted: ReadonlySet<MemoryFile>; onOpen(file: MemoryFile): void }) {
  return (
    <nav aria-label="Memory files" className="md:w-48 md:shrink-0">
      <ul className="flex flex-wrap gap-1 md:flex-col">
        {files.map((file) => (
          <li key={file}>
            <button
              type="button"
              aria-current={file === open ? "true" : undefined}
              onClick={() => onOpen(file)}
              className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-3 text-left font-mono text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-[current=true]:bg-state-active aria-[current=true]:text-foreground"
            >
              <span className="min-w-0 flex-1 truncate">{file}</span>
              {drafted.has(file) && (
                <span className="size-1.5 shrink-0 rounded-full bg-foreground">
                  <span className="sr-only">, unsaved changes</span>
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
