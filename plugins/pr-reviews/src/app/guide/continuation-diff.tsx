// A hunk's code after a finding block. experimental_Diff draws a patch that starts past line 1
// with a leading "N unmodified lines" separator; after a finding block those lines were just drawn
// above, so the separator is false, and this hides it. The first slice of a hunk is a plain <Diff>,
// whose separator is real.
//
// why reach into bb's diff: experimental_Diff takes no option for its separators. It draws into a
// `diffs-container` element with an open shadow root, which page CSS cannot cross, so the rule goes
// inside that root. If bb renames the element or the separator's attributes, nothing matches and
// the separator shows again: wrong, never broken.
import { useEffect, useRef } from "react";
import { experimental_Diff as Diff } from "@get-bb/plugin-sdk/app";

const HIDE_LEADING_SEPARATOR = "[data-separator][data-separator-first] { display: none; }";
const MARK = "data-pr-reviews-continuation";

export function ContinuationDiff({ patch, path }: { patch: string; path: string }) {
  const wrapper = useRef<HTMLDivElement>(null);

  // bb loads its diff lazily and may replace it, so the rule goes into every container that appears.
  useEffect(() => {
    const element = wrapper.current!;
    const hide = () => element.querySelectorAll("diffs-container").forEach((container) => hideLeadingSeparator(container.shadowRoot));
    hide();
    const observer = new MutationObserver(hide);
    observer.observe(element, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={wrapper}>
      <Diff patch={patch} path={path} />
    </div>
  );
}

function hideLeadingSeparator(root: ShadowRoot | null) {
  if (root === null || root.querySelector(`style[${MARK}]`) !== null) return;
  const style = document.createElement("style");
  style.setAttribute(MARK, "");
  style.textContent = HIDE_LEADING_SEPARATOR;
  root.append(style);
}
