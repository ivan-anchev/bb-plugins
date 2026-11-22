import type { StepFile } from "../../guide/step-files.ts";
import { FileIcon } from "./file-icon.tsx";

type StepFileListProps = { files: StepFile[]; onJump(path: string): void };

export function StepFileList({ files, onJump }: StepFileListProps) {
  return (
    <ul aria-label="Files in this step" className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
      {files.map((file) => (
        <li key={file.path}>
          <FileRow file={file} onJump={onJump} />
        </li>
      ))}
    </ul>
  );
}

function FileRow({ file, onJump }: { file: StepFile; onJump(path: string): void }) {
  const { name, folder } = splitPath(file.path);
  const tag = statusTagOf(file.status);
  return (
    <button
      type="button"
      title={file.path}
      aria-label={`${file.path}${tag === null ? "" : `, ${tag.label.toLowerCase()} file`}: ${file.added} added, ${file.removed} removed`}
      onClick={() => onJump(file.path)}
      className="flex min-h-9 w-full cursor-pointer touch-manipulation items-center gap-2.5 rounded-lg bg-surface-recessed px-3 text-left text-sm outline-none transition-colors duration-150 ease-out hover:bg-state-hover focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none"
    >
      <FileIcon path={file.path} />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5 whitespace-pre">
        <span className="max-w-full shrink-0 truncate">{name}</span>
        <span className="min-w-0 truncate text-subtle-foreground">{folder}</span>
      </span>
      {tag !== null && <StatusTag tag={tag} />}
      <LineCounts added={file.added} removed={file.removed} />
    </button>
  );
}

const STATUS_TAGS = {
  added: { label: "New", tone: "bg-diff-added/12 text-diff-added" },
  deleted: { label: "Deleted", tone: "bg-diff-removed/12 text-diff-removed" },
};

type StatusTag = (typeof STATUS_TAGS)[keyof typeof STATUS_TAGS];

const statusTagOf = (status: StepFile["status"]): StatusTag | null =>
  status === "added" || status === "deleted" ? STATUS_TAGS[status] : null;

function StatusTag({ tag }: { tag: StatusTag }) {
  return <span className={`shrink-0 rounded px-1.5 py-px text-xs font-medium ${tag.tone}`}>{tag.label}</span>;
}

function LineCounts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="flex shrink-0 gap-1.5 tabular-nums">
      {added > 0 && <span className="text-diff-added">+{added}</span>}
      {removed > 0 && <span className="text-diff-removed">−{removed}</span>}
    </span>
  );
}

function splitPath(path: string): { name: string; folder: string } {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? { name: path, folder: "" } : { name: path.slice(slash + 1), folder: path.slice(0, slash) };
}
