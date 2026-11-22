import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { Content, Item, Portal, Root, Trigger } from "@radix-ui/react-dropdown-menu";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { PORTAL_SCOPE } from "../../ui/portal-scope.ts";
import { START_SHORTCUTS, startShortcut, type StartKind } from "./start-shortcut.ts";

/** Runs an armed start: focus waits on the list, and the start begins. */
export type Fire = () => void;
/** Arms a start: the picks hold at once, and nothing runs until the returned `fire`. */
export type Arm = () => Fire;

type StartButtonProps = {
  /** A start or a delete is on its way: every half waits for it. */
  disabled: boolean;
  newThread: Arm;
  /** Null where no thread is on screen: then there is no menu. */
  thisThread: Arm | null;
};

export function StartButton({ disabled, newThread, thisThread }: StartButtonProps) {
  const main = (
    <button
      type="button"
      className="nt-go"
      disabled={disabled}
      title={`New thread (${START_SHORTCUTS["new-thread"].hint})`}
      aria-keyshortcuts={START_SHORTCUTS["new-thread"].aria}
      onClick={() => newThread()()}
    >
      New thread
    </button>
  );
  if (thisThread === null) return main;
  return (
    <span className="nt-split">
      {main}
      <StartMenu disabled={disabled} newThread={newThread} thisThread={thisThread} />
    </span>
  );
}

type StartMenuProps = { disabled: boolean; newThread: Arm; thisThread: Arm };

function StartMenu({ disabled, newThread, thisThread }: StartMenuProps) {
  const armed = useRef<Fire | null>(null);
  const [open, setOpen] = useState(false);
  const choose = (arm: Arm) => {
    armed.current = arm();
    setOpen(false);
  };
  const onShortcut = (event: KeyboardEvent) => {
    const kind = startShortcut(event);
    if (kind === null) return;
    event.preventDefault();
    if (armed.current !== null) return;
    choose(kind === "new-thread" ? newThread : thisThread);
  };

  return (
    <Root open={open} onOpenChange={setOpen}>
      <Trigger asChild>
        <button type="button" className="nt-go nt-split-more" aria-label="More ways to start" disabled={disabled}>
          <Icon name="ChevronDown" aria-hidden />
        </button>
      </Trigger>
      <Portal>
        <Content
          {...PORTAL_SCOPE}
          onKeyDownCapture={onShortcut}
          onCloseAutoFocus={(event) => {
            const fire = armed.current;
            if (fire === null) return;
            armed.current = null;
            event.preventDefault();
            fire();
          }}
          align="end"
          sideOffset={4}
          collisionPadding={8}
          className="nt-menu z-50 min-w-28 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2"
        >
          <StartItem kind="new-thread" onSelect={() => choose(newThread)}>
            New thread
          </StartItem>
          <StartItem kind="this-thread" onSelect={() => choose(thisThread)}>
            Send to this thread
          </StartItem>
        </Content>
      </Portal>
    </Root>
  );
}

type StartItemProps = { kind: StartKind; onSelect(): void; children: ReactNode };

function StartItem({ kind, onSelect, children }: StartItemProps) {
  const { hint, aria } = START_SHORTCUTS[kind];
  return (
    <Item
      onSelect={onSelect}
      aria-keyshortcuts={aria}
      className="nt-menu-item relative flex cursor-default select-none items-center rounded-sm px-2 py-[0.3125rem] text-xs outline-none transition-none focus:bg-state-hover focus:text-foreground"
    >
      {children}
      <kbd className="nt-menu-hint" aria-hidden>
        {hint}
      </kbd>
    </Item>
  );
}
