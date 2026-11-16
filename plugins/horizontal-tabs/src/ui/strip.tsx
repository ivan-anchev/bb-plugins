// The strip: a WAI-ARIA tablist of every tab. The selected tab, else the live one, is its one tab stop.
import { useTabs } from "../controller/tabs.ts";
import { TabItem } from "./tab.tsx";

export function Strip() {
  const snapshot = useTabs();
  if (snapshot === null) return null;
  const { set, selectedId } = snapshot;
  return (
    <div className="ht-strip">
      <div role="tablist" aria-label="Tabs" className="ht-tablist">
        {set.tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            selected={tab.id === selectedId}
            tabStop={tab.id === (selectedId ?? set.liveId)}
            index={snapshot}
          />
        ))}
      </div>
    </div>
  );
}
