// The files a step touches, under its story: icon, name, the dimmed folder and the step's own
// `+N −M`. Each row is a button that jumps the diffs to the file's first hunk.
import type { StepFile } from "../../guide/step-files.ts";
import { FileIcon } from "./file-icon.tsx";

type StepFileListProps = { files: StepFile[]; onJump(path: string): void };

export function StepFileList({ files, onJump }: StepFileListProps) {
  return (
    <ul aria-label="Files in this step" className="grid gap-1.5">
      {files.map((file) => (
        <li key={file.path}>
          <FileRow file={file} onJump={onJump} />
        </li>
      ))}
    </ul>
  );
}

// The ring is inset: the story column scrolls on its own, which would clip a ring drawn outside.
function FileRow({ file, onJump }: { file: StepFile; onJump(path: string): void }) {
  const { name, folder } = splitPath(file.path);
  return (
    <button
      type="button"
      title={file.path}
      aria-label={`${file.path}: ${file.added} added, ${file.removed} removed`}
      onClick={() => onJump(file.path)}
      className="flex min-h-9 w-full cursor-pointer touch-manipulation items-center gap-2.5 rounded-lg bg-muted/40 px-3 text-left text-[13px] outline-none transition-colors duration-150 ease-out hover:bg-state-hover focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none"
    >
      <FileIcon path={file.path} />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5 whitespace-pre">
        <span className="max-w-full shrink-0 truncate">{name}</span>
        <span className="min-w-0 truncate text-subtle-foreground">{folder}</span>
      </span>
      <LineCounts added={file.added} removed={file.removed} />
    </button>
  );
}

// A side with no lines is left out, as in "+57"; a file with no text lines shows neither.
function LineCounts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="flex shrink-0 gap-1.5 tabular-nums">
      {added > 0 && <span className="text-diff-added">+{added}</span>}
      {removed > 0 && <span className="text-diff-removed">−{removed}</span>}
    </span>
  );
}

// Display only: the path itself is never changed, and `whitespace-pre` keeps its spaces.
function splitPath(path: string): { name: string; folder: string } {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? { name: path, folder: "" } : { name: path.slice(slash + 1), folder: path.slice(0, slash) };
}
