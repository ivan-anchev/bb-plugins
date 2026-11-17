// The Changes tab's list (GitHub's Files changed, bb's own Changes panel): every listed file's
// card, top to bottom in the tree's order, in one scroll region that is the list's one tab stop.
// A diff draws as the reader nears its file (file-section.tsx). A jump scrolls a file's card to
// the top; as the reader scrolls, the list reports the file they are on.
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

// Memoised: the panel re-renders as the tree follows the reader, which changes nothing here.
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
        <div ref={cards}>
          {files.map(({ treePath, file }) => (
            <FileSection key={treePath} file={file} head={head} settings={settings} jump={jump?.treePath === treePath ? jump : null} />
          ))}
        </div>
      </ListPane>
    </ApproachContext.Provider>
  );
});

// What the reader does to scroll the list themselves, which ends a jump's hold.
const READER_SCROLLS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

// A jump scrolls its file's card to the list's top, and holds the reader on that file until they
// scroll themselves: a card near the list's end can't reach the top, and the diffs drawing above
// it move the list as they draw. Returns the hold. A jump to a file the filters hide does nothing.
// A jump waits for the list to be shown: the page keeps the tab mounted under another, where the
// list has no size, as when it opens on the remembered file under the Summary tab.
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

// The line the reader is on: under a card's sticky header, once it has reached the top.
const READING_LINE = 40;

// The file the reader is on, reported as they scroll, once a frame at most, and as the listed
// files or the list's size change, as when its tab shows, unless a jump holds it. A hidden list
// has no size and reports nothing.
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

/** Runs `show` now if `element` has a size, or once it has one; returns what cancels the wait. */
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

/** Each file's offset in the list, in order. */
function topsOf(region: HTMLElement, cards: HTMLElement): number[] {
  const offset = region.scrollTop - region.getBoundingClientRect().top;
  return Array.from(cards.children, (card) => card.getBoundingClientRect().top + offset);
}

// why a block, not a flex column: a diff would shrink to the pane as a flex item and scroll
// itself, out of reach of the pane's tab stop, since the keys scroll only the focused element and
// its ancestors. As a block each takes its full height and the pane scrolls them. The ring sits
// inside: the pane runs to the split's edges. Its padding is bb's Changes panel's around the
// file's card, less on the tree's side, where no divider shows, and none on top (FileSection).
function ListPane({ ref, children }: { ref: RefCallback<HTMLDivElement>; children: ReactNode }) {
  return (
    <div
      ref={ref}
      role="region"
      aria-label="Diff"
      tabIndex={0}
      className="min-h-0 flex-1 overflow-auto pr-4 pb-3 pl-2 outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
    >
      {children}
    </div>
  );
}
