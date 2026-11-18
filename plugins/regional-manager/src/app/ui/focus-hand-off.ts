// Focus that moves from a region as it unmounts to the one that replaces it, so focus never drops
// to the page body (REVIEW.md). Copied from pr-reviews, since plugins cannot import each other.
import { useLayoutEffect, useMemo, type RefCallback } from "react";

/** `from` on the region that leaves, `to` on the element that takes its focus. */
type FocusHandOff = { from: RefCallback<HTMLElement>; to: RefCallback<HTMLElement> };

// why ref callbacks: React detaches a ref before it removes the element, so `from`'s cleanup still
// sees whether the region holds focus, and attaches one after it inserts the element, so `to` can
// take that focus in the same commit. Both are stable, so neither runs again on a re-render.
// Several regions can leave in one commit (a block that splits remounts its lines); any one that
// held focus hands it off, whatever order they leave in.
export function useFocusHandOff(): FocusHandOff {
  return useMemo(() => {
    let handingOff = false;
    return {
      from: (region) => {
        if (region === null) return;
        return () => {
          if (region.contains(document.activeElement)) handingOff = true;
        };
      },
      to: (target) => {
        if (target === null || !handingOff) return;
        handingOff = false;
        target.focus();
      },
    };
  }, []);
}

/**
 * A ref for a region that leaves while the page around it stays, such as a failed read's notice once
 * Retry succeeds: focus in it moves to the page's tab stop, the element every page scrolls by
 * (REVIEW.md). why not `to`: the page is already there, so no element mounts to take the focus.
 */
export function handFocusToPage(region: HTMLElement | null): (() => void) | undefined {
  if (region === null) return;
  return () => {
    if (region.contains(document.activeElement)) pageOf(region)?.focus();
  };
}

/** The refs that keep focus as items move between groups (useFocusKeptAcrossGroups). Each is stable per key. */
type GroupFocus<Group> = {
  /** On the whole item: focus anywhere in it as it leaves (its row, a link beside it, its open detail) is kept; in an item nested in another, by the nested one. */
  item(key: string): RefCallback<HTMLElement>;
  /** On the element of the item that takes the focus kept, where the item lands. */
  target(key: string): RefCallback<HTMLElement>;
  /** On a group's header, which takes it while the item's group is folded. */
  header(group: Group): RefCallback<HTMLElement>;
  /**
   * Moves focus to the item's target once the next commit has drawn it, as when the user goes to an
   * item in a group being unfolded for it, without scrolling to it: `landed` gets the target, to
   * bring it into view as it needs.
   */
  moveTo(key: string, landed: (target: HTMLElement) => void): void;
};

/**
 * Focus kept by items that move from one group to another, some groups folded, such as a board's rows
 * moving lanes: React removes an item from its old list and mounts it in the new one, or nowhere while
 * the new one is folded. Once the commit is done, focus that was anywhere in the leaving item goes to
 * its target where it landed, or to the header of the group it is in now (`groupOf`, null: in none),
 * or, once the item is gone from every group, to the tab stop of the page it was in. `moveTo` sends
 * focus the same way, to an item that need not have held it, and leaves scrolling to it to the caller.
 */
export function useFocusKeptAcrossGroups<Group>(groupOf: (key: string) => Group | null): GroupFocus<Group> {
  const kept = useMemo(() => {
    // The focus to hand over once the commit is done: kept by an item that left (landed: null, as
    // focus scrolls), or asked for by moveTo.
    let pending: { key: string; page: HTMLElement | null; landed: ((target: HTMLElement) => void) | null } | null = null;
    const targets = new Map<string, HTMLElement>();
    const headers = new Map<Group, HTMLElement>();
    return {
      refs: {
        item: stablePerKey((key: string): RefCallback<HTMLElement> => (item) => {
          if (item === null) return;
          return () => {
            // why the last one wins: React detaches a removed tree's refs parent first, so of an item
            // nested in another (a sub-issue under its parent), the nested one's cleanup runs last.
            // why read the page now: the item is still in it, and nothing of it is once it's gone.
            if (item.contains(document.activeElement)) pending = { key, page: pageOf(item), landed: null };
          };
        }),
        target: stablePerKey((key: string) => tracked(targets, key)),
        header: stablePerKey((group: Group) => tracked(headers, group)),
        moveTo: (key: string, landed: (target: HTMLElement) => void) => {
          pending = { key, page: null, landed };
        },
      },
      /** Hands the focus pending to where its item landed; nothing when none is. */
      land(groupOf: (key: string) => Group | null) {
        if (pending === null) return;
        const { key, page, landed } = pending;
        pending = null;
        const target = targets.get(key);
        if (target !== undefined && landed !== null) {
          target.focus({ preventScroll: true });
          landed(target);
          return;
        }
        const group = groupOf(key);
        (target ?? (group === null ? undefined : headers.get(group)) ?? page)?.focus();
      },
    };
  }, []);
  // why a layout effect: a parent's runs after React has removed the leaving item and attached every
  // ref of the commit, so both where the item landed and every header are known, before paint.
  useLayoutEffect(() => kept.land(groupOf));
  return kept.refs;
}

// ------------------------------------------------------------------ layer 2

/** The tab stop of the page around `element`: the element the page scrolls by (REVIEW.md). */
const pageOf = (element: HTMLElement): HTMLElement | null => element.parentElement?.closest<HTMLElement>('[tabindex="0"]') ?? null;

/** A ref that keeps `map` pointing at the element mounted for `key`. */
function tracked<Key>(map: Map<Key, HTMLElement>, key: Key): RefCallback<HTMLElement> {
  return (element) => {
    if (element === null) return;
    map.set(key, element);
    return () => {
      if (map.get(key) === element) map.delete(key);
    };
  };
}

/** `make`, made once per key. why: a new ref callback each render would detach and attach its element each render. */
function stablePerKey<Key>(make: (key: Key) => RefCallback<HTMLElement>): (key: Key) => RefCallback<HTMLElement> {
  const refs = new Map<Key, RefCallback<HTMLElement>>();
  return (key) => {
    const ref = refs.get(key) ?? make(key);
    refs.set(key, ref);
    return ref;
  };
}
