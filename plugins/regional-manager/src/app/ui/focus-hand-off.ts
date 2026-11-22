import { useLayoutEffect, useMemo, type RefCallback } from "react";

/** `from` on the region that leaves, `to` on the element that takes its focus. */
type FocusHandOff = { from: RefCallback<HTMLElement>; to: RefCallback<HTMLElement> };

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
 * A ref for a region that leaves while the element that takes its focus stays, such as the toggle that
 * closed it: focus in it moves to `target`'s element. why not `to`: that element is already there, so
 * nothing mounts to take the focus.
 */
export function handFocusTo(target: (region: HTMLElement) => HTMLElement | null | undefined): (region: HTMLElement | null) => (() => void) | undefined {
  return (region) => {
    if (region === null) return;
    return () => {
      if (region.contains(document.activeElement)) target(region)?.focus();
    };
  };
}

/**
 * A ref for a region that leaves while the page around it stays, such as a failed read's notice once
 * Retry succeeds: focus in it moves to the page's tab stop, the element every page scrolls by (REVIEW.md).
 */
export const handFocusToPage = handFocusTo(pageOf);

/** The refs that keep focus as items move between groups (useFocusKeptAcrossGroups). Each is stable per key. */
type GroupFocus<Group> = {
  /** On the whole item: focus anywhere in it as it leaves (its row, a link beside it) is kept; in an item nested in another, by the nested one. */
  item(key: string): RefCallback<HTMLElement>;
  /** On the element of the item that takes the focus kept, where the item lands. */
  target(key: string): RefCallback<HTMLElement>;
  /** On a group's header, which takes it while the item's group is folded. */
  header(group: Group): RefCallback<HTMLElement>;
};

/**
 * Focus kept by items that move from one group to another, some groups folded, such as a board's rows
 * moving lanes: React removes an item from its old list and mounts it in the new one, or nowhere while
 * the new one is folded. Once the commit is done, focus that was anywhere in the leaving item goes to
 * its target where it landed, or to the header of the group it is in now (`groupOf`, null: in none),
 * or, once the item is gone from every group, to the tab stop of the page it was in.
 */
export function useFocusKeptAcrossGroups<Group>(groupOf: (key: string) => Group | null): GroupFocus<Group> {
  const kept = useMemo(() => {
    let pending: { key: string; page: HTMLElement | null } | null = null;
    const targets = new Map<string, HTMLElement>();
    const headers = new Map<Group, HTMLElement>();
    return {
      refs: {
        item: stablePerKey((key: string): RefCallback<HTMLElement> => (item) => {
          if (item === null) return;
          return () => {
            if (item.contains(document.activeElement)) pending = { key, page: pageOf(item) };
          };
        }),
        target: stablePerKey((key: string) => tracked(targets, key)),
        header: stablePerKey((group: Group) => tracked(headers, group)),
      },
      land(groupOf: (key: string) => Group | null) {
        if (pending === null) return;
        const { key, page } = pending;
        pending = null;
        const target = targets.get(key);
        const group = groupOf(key);
        (target ?? (group === null ? undefined : headers.get(group)) ?? page)?.focus();
      },
    };
  }, []);
  useLayoutEffect(() => kept.land(groupOf));
  return kept.refs;
}

function pageOf(element: HTMLElement): HTMLElement | null {
  return element.parentElement?.closest<HTMLElement>('[tabindex="0"]') ?? null;
}

function tracked<Key>(map: Map<Key, HTMLElement>, key: Key): (element: HTMLElement | null) => (() => void) | undefined {
  return (element) => {
    if (element === null) return;
    map.set(key, element);
    return () => {
      if (map.get(key) === element) map.delete(key);
    };
  };
}

function stablePerKey<Key>(make: (key: Key) => RefCallback<HTMLElement>): (key: Key) => RefCallback<HTMLElement> {
  const refs = new Map<Key, RefCallback<HTMLElement>>();
  return (key) => {
    const ref = refs.get(key) ?? make(key);
    refs.set(key, ref);
    return ref;
  };
}
