import type { RefCallback } from "react";

/** One ref callback for an element several refs need: it sets each, and cleans each up. */
export function mergeRefs<Element>(...refs: RefCallback<Element>[]): RefCallback<Element> {
  return (element) => {
    const cleanups = refs.map((ref) => ref(element));
    return () => cleanups.forEach((cleanup, index) => (typeof cleanup === "function" ? cleanup() : refs[index](null)));
  };
}
