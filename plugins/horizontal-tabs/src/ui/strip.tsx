import { useLayoutEffect, useRef } from "react";
import { tabs, useTabs } from "../controller/tabs.ts";
import { useChromeInset } from "../host/strip-mount.ts";
import { TabItem } from "./tab.tsx";

export function Strip() {
  const snapshot = useTabs();
  const inset = useChromeInset();
  const strip = useRef<HTMLDivElement>(null);
  const tablist = useRef<HTMLDivElement>(null);
  const focusFrom = useRef<Element | null>(null);

  useLayoutEffect(() => {
    const held = focusFrom.current;
    focusFrom.current = null;
    if (held !== null && !held.isConnected) tablist.current?.querySelector<HTMLElement>('[role="tab"][tabindex="0"]')?.focus();
  });

  const selected = snapshot?.selectedId;
  useLayoutEffect(() => {
    tablist.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected]);

  if (snapshot === null) return null;
  const { set, selectedId, notice } = snapshot;
  const holdFocus = () => {
    focusFrom.current = strip.current?.contains(document.activeElement) ? document.activeElement : null;
  };
  const close = (id: string) => {
    holdFocus();
    tabs.close(id);
  };
  const dismiss = () => {
    holdFocus();
    tabs.dismissNotice();
  };
  return (
    <div ref={strip} className="ht-strip">
      <span
        aria-hidden
        className={"classes" in inset ? `ht-inset ${inset.classes}` : "ht-inset"}
        style={"padding" in inset ? { paddingLeft: inset.padding } : undefined}
      />
      <div ref={tablist} role="tablist" aria-label="Tabs" className="ht-tablist">
        {set.tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            selected={tab.id === selectedId}
            tabStop={tab.id === (selectedId ?? set.liveId)}
            onClose={set.tabs.length > 1 ? () => close(tab.id) : null}
            index={snapshot}
          />
        ))}
      </div>
      <button type="button" className="ht-new" aria-label="New tab" title="New tab" onClick={() => tabs.openNew()}>
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <div role="status" className="ht-notice">
        {notice && (
          <>
            <span className="ht-notice-text">Exact layout restore unavailable; using equal splits</span>
            <button type="button" className="ht-dismiss" aria-label="Dismiss" title="Dismiss" onClick={dismiss}>
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
