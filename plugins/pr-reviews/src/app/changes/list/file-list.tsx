import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefCallback, type RefObject } from "react";
import type { PrHeadTarget } from "../../queries.ts";
import type { DiffSettings } from "../../diff/diff-options.ts";
import { mergeRefs } from "../../ui/merge-refs.ts";
import type { TreeFile } from "../tree/tree-input.ts";
import { ApproachContext, approachWatcher } from "./approach.ts";
import { fileIndexAt } from "./current-file.ts";
import { FileSection, type Jump } from "./file-section.tsx";

/**
 * `ref`: the list's scroll region. `head`: the PR at the commit its diff was read at. `jump`: the
 * latest jump, applied once. `onCurrentFile`: the file the reader scrolled to, by its tree path.
 */
type FileListProps = {
  ref: RefCallback<HTMLElement>;
  files: readonly TreeFile[];
  head: PrHeadTarget;
  settings: DiffSettings;
  jump: Jump | null;
  onCurrentFile(treePath: string): void;
};

type Elements = { region: RefObject<HTMLDivElement | null>; cards: RefObject<HTMLDivElement | null> };

export const FileList = memo(function FileList({ ref, files, head, settings, jump, onCurrentFile }: FileListProps) {
  const [watcher] = useState(approachWatcher);
  const region = useRef<HTMLDivElement | null>(null);
  const cards = useRef<HTMLDivElement>(null);
  const elements = { region, cards };
  const held = useJumps(elements, files, jump);
  useCurrentFile(elements, files, held, onCurrentFile);
  const attachRegion = useCallback(
    (element: HTMLDivElement | null) => {
      if (element === null) return;
      region.current = element;
      return watcher.attach(element);
    },
    [watcher],
  );
  const regionRef = useMemo(() => mergeRefs(ref, attachRegion), [ref, attachRegion]);

  return (
    <ApproachContext.Provider value={watcher}>
      <ListPane ref={regionRef}>
        <div ref={cards} className="space-y-2">
          {files.map(({ treePath, file }) => (
            <FileSection key={treePath} file={file} head={head} settings={settings} jump={jump?.treePath === treePath ? jump : null} />
          ))}
        </div>
      </ListPane>
    </ApproachContext.Provider>
  );
});

const READER_SCROLLS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

function useJumps({ region, cards }: Elements, files: readonly TreeFile[], jump: Jump | null): RefObject<boolean> {
  const held = useRef(false);
  const applied = useRef<Jump | null>(null);

  useLayoutEffect(() => {
    if (jump === null || jump === applied.current) return;
    const element = region.current!;
    const apply = () => {
      applied.current = jump;
      const index = files.findIndex((listed) => listed.treePath === jump.treePath);
      if (index === -1) return;
      held.current = true;
      element.scrollTop = topsOf(element, cards.current!)[index];
    };
    return whenShown(element, apply);
  }, [region, cards, files, jump]);

  useEffect(() => {
    const element = region.current!;
    const release = () => {
      held.current = false;
    };
    for (const type of READER_SCROLLS) element.addEventListener(type, release, { passive: true });
    return () => {
      for (const type of READER_SCROLLS) element.removeEventListener(type, release);
    };
  }, [region]);

  return held;
}

const READING_LINE = 40;

function useCurrentFile({ region, cards }: Elements, files: readonly TreeFile[], held: RefObject<boolean>, onCurrentFile: (treePath: string) => void) {
  useEffect(() => {
    if (files.length === 0) return;
    const element = region.current!;
    let frame = 0;
    let reported: string | null = null;
    const follow = () => {
      frame = 0;
      if (held.current || element.clientHeight === 0) return;
      const { treePath } = files[fileIndexAt(topsOf(element, cards.current!), element.scrollTop + READING_LINE)];
      if (treePath === reported) return;
      reported = treePath;
      onCurrentFile(treePath);
    };
    const moved = () => {
      if (frame === 0) frame = requestAnimationFrame(follow);
    };
    const resized = new ResizeObserver(moved);
    resized.observe(element);
    element.addEventListener("scroll", moved, { passive: true });
    return () => {
      resized.disconnect();
      element.removeEventListener("scroll", moved);
      cancelAnimationFrame(frame);
    };
  }, [region, cards, files, held, onCurrentFile]);
}

function whenShown(element: HTMLElement, show: () => void): (() => void) | undefined {
  if (element.clientHeight > 0) {
    show();
    return;
  }
  const sized = new ResizeObserver(() => {
    if (element.clientHeight === 0) return;
    sized.disconnect();
    show();
  });
  sized.observe(element);
  return () => sized.disconnect();
}

function topsOf(region: HTMLElement, cards: HTMLElement): number[] {
  const offset = region.scrollTop - region.getBoundingClientRect().top;
  return Array.from(cards.children, (card) => card.getBoundingClientRect().top + offset);
}

function ListPane({ ref, children }: { ref: RefCallback<HTMLDivElement>; children: ReactNode }) {
  return (
    <div
      ref={ref}
      role="region"
      aria-label="Diff"
      tabIndex={0}
      className="mt-2 min-h-0 flex-1 overflow-auto pr-4 pb-3 pl-2 outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
    >
      {children}
    </div>
  );
}
