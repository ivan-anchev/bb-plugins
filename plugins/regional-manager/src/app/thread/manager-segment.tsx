// A regional manager's own thread names it in the context row above its composer: its icon and its
// name, and never its description. Pressing them opens its profile's editor below the row, where Save,
// Cancel and Esc close it, and the focus goes back to them.
import { experimental_THREAD_CONTEXT_SEGMENT_GROUPS as GROUPS, type ExperimentalThreadContextSegmentProps } from "@get-bb/plugin-sdk/app";
import { useCallback, useMemo } from "react";
import type { Profile } from "../../model/profile.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { AvatarTile } from "../profile/avatar.tsx";
import { draftOf, profileDraftSchema, profileEditKeyOf } from "../profile/profile-draft.ts";
import { ProfileEditor } from "../profile/profile-editor.tsx";
import { useCoordinatorOfThread, useManager } from "../profile/use-manager.ts";
import { handFocusTo } from "../ui/focus-hand-off.ts";
import { useStored } from "../ui/stored.ts";

export const managerSegment = {
  id: "manager",
  title: "Regional manager",
  group: GROUPS.thread,
  summary: ManagerToggle,
  details: ManagerDetails,
  useVisible: ({ threadId }: { threadId: string }) => useCoordinatorOfThread(threadId).coordinator !== null,
};

// why by thread: bb mounts the summary and the details apart, so the editor finds here the toggle that
// takes its focus back as it closes.
const toggles = new Map<string, HTMLButtonElement>();

function ManagerToggle({ threadId, isExpanded, onToggle }: ExperimentalThreadContextSegmentProps) {
  const manager = useManagerOfThread(threadId);
  const toggleRef = useCallback(
    (button: HTMLButtonElement | null) => {
      if (button === null) return;
      toggles.set(threadId, button);
      return () => {
        if (toggles.get(threadId) === button) toggles.delete(threadId);
      };
    },
    [threadId],
  );
  return manager === null ? null : (
    <button
      ref={toggleRef}
      type="button"
      aria-expanded={isExpanded}
      aria-label={`${manager.profile.name}, edit profile`}
      onClick={onToggle}
      className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <AvatarTile avatar={manager.profile.avatar} size="xs" />
      <span className="truncate">{manager.profile.name}</span>
    </button>
  );
}

function ManagerDetails({ threadId, isExpanded, onToggle }: ExperimentalThreadContextSegmentProps) {
  const manager = useManagerOfThread(threadId);
  return !isExpanded || manager === null ? null : <Editor threadId={threadId} {...manager} onClose={onToggle} />;
}

type EditorProps = { threadId: string; coordinatorId: CoordinatorId; profile: Profile; onClose(): void };

/** The profile's editor, on the edit the browser keeps (stored.ts), or the profile as saved while there is none. */
function Editor({ threadId, coordinatorId, profile, onClose }: EditorProps) {
  const edit = useStored(localStorage, profileEditKeyOf(coordinatorId), profileDraftSchema);
  // The toggle stays as the editor opens and closes, so the focus moves to the name only from it, and back to it from the editor.
  const takeFocus = useCallback(
    (name: HTMLElement | null) => {
      if (name !== null && document.activeElement === toggles.get(threadId)) name.focus();
    },
    [threadId],
  );
  const regionRef = useMemo(() => handFocusTo(() => toggles.get(threadId)), [threadId]);

  function close() {
    edit.store(null);
    onClose();
  }

  // why Esc keeps the edit: it closes the editor as the toggle does, and pressing the toggle again
  // brings back what the user typed; Cancel drops it.
  return (
    <div ref={regionRef} className="px-3 py-3">
      <ProfileEditor coordinatorId={coordinatorId} profile={profile} draft={edit.value ?? draftOf(profile)} onChange={edit.store} onClose={close} onEscape={onClose} takeFocus={takeFocus} trailing={null} />
    </div>
  );
}

/** The regional manager whose thread this is, with its profile; null for any other thread, or before both reads. */
function useManagerOfThread(threadId: string): { coordinatorId: CoordinatorId; profile: Profile } | null {
  const { coordinator } = useCoordinatorOfThread(threadId);
  const profile = useManager(coordinator?.id ?? null)?.profile ?? null;
  return coordinator === null || profile === null ? null : { coordinatorId: coordinator.id, profile };
}
