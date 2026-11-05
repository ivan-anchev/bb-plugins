import { useRef } from "react";
import type { ExperimentalThreadTabProps } from "@get-bb/plugin-sdk/app";
import { AllFilesView } from "./all-files-view.tsx";
import { ChangesView } from "./changes-view.tsx";
import { Notice, SegmentedControl, TabFrame, Toolbar, type RefreshHandle, type SegmentOption } from "./chrome.tsx";
import { useRememberedState } from "./hooks/use-remembered-state.ts";

type View = "files" | "changes";

const VIEW_OPTIONS: readonly SegmentOption<View>[] = [
  { value: "files", label: "All files", icon: "Folder" },
  { value: "changes", label: "Changes", icon: "FileDiff" },
];

const rememberedViews = new Map<string, View>();

export function FilesTab({ environment }: ExperimentalThreadTabProps) {
  return environment === null ? (
    <TabFrame>
      <Notice>This thread has no environment, so there are no files to show.</Notice>
    </TabFrame>
  ) : (
    <EnvironmentFiles key={environment.id} environmentId={environment.id} />
  );
}

function EnvironmentFiles({ environmentId }: { environmentId: string }) {
  const [view, setView] = useRememberedState(rememberedViews, environmentId, "files");
  const shownView = useRef<RefreshHandle>(null);

  return (
    <TabFrame>
      <Toolbar onRefresh={() => shownView.current?.refresh()}>
        <SegmentedControl label="Files view" options={VIEW_OPTIONS} value={view} onChange={setView} />
      </Toolbar>
      {view === "files" ? (
        <AllFilesView ref={shownView} environmentId={environmentId} />
      ) : (
        <ChangesView ref={shownView} environmentId={environmentId} />
      )}
    </TabFrame>
  );
}
