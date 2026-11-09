// bb's dropdown menu, as plugins/pr-reviews vendors it, plus the labels, separators and radio groups
// the chip needs: labelled groups with one checked row, disabled rows dimmed. Classes follow bb's own
// DropdownMenu, as its Modal chip renders it, except that the menu only fades under reduced motion and
// its rows are 44px tall on touch screens.
import type { ReactNode } from "react";
import { Content, Item, ItemIndicator, Label, Portal, RadioGroup, RadioItem, Root, Separator, Trigger } from "@radix-ui/react-dropdown-menu";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { PORTAL_SCOPE } from "./portal-scope.ts";

export { Root as Menu, Trigger as MenuTrigger };

/** The zoom and slide as bb's menus open and close; with reduced motion the menu only fades. */
const MOVEMENT =
  "motion-safe:data-[state=closed]:zoom-out-95 motion-safe:data-[state=open]:zoom-in-95 motion-safe:data-[side=bottom]:slide-in-from-top-2 motion-safe:data-[side=top]:slide-in-from-bottom-2";

type MenuContentProps = { align: "start" | "end"; className?: string; children: ReactNode };

export function MenuContent({ align, className = "", children }: MenuContentProps) {
  return (
    <Portal>
      <Content
        {...PORTAL_SCOPE}
        align={align}
        sideOffset={4}
        collisionPadding={8}
        className={`z-50 min-w-28 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 ${MOVEMENT} ${className}`}
      >
        {children}
      </Content>
    </Portal>
  );
}

const LABEL = "px-2 py-[0.3125rem] text-xs font-medium text-muted-foreground";

export function MenuSeparator() {
  return <Separator className="-mx-1 my-1 h-px bg-muted" />;
}

/** bb's menu row, at least 44px tall for a finger on a touch screen. */
const ITEM = "relative flex cursor-default select-none items-center justify-between gap-3 rounded-sm px-2 py-[0.3125rem] text-xs outline-none transition-none pointer-coarse:min-h-11 focus:bg-state-hover focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

/** `onSelect` may call `event.preventDefault()` to keep the menu open. */
export function MenuItem({ onSelect, children }: { onSelect(event: Event): void; children: ReactNode }) {
  return (
    <Item onSelect={onSelect} className={ITEM}>
      {children}
    </Item>
  );
}

type MenuRadioGroupProps = { label: string; value: string | undefined; children: ReactNode };

/** A labelled group with one checked row: `value` names it, and undefined checks none. */
export function MenuRadioGroup({ label, value, children }: MenuRadioGroupProps) {
  return (
    <RadioGroup aria-label={label} value={value}>
      <Label aria-hidden className={LABEL}>
        {label}
      </Label>
      {children}
    </RadioGroup>
  );
}

type MenuRadioItemProps = { value: string; onSelect(): void; disabled?: boolean; children: ReactNode };

export function MenuRadioItem({ value, onSelect, disabled = false, children }: MenuRadioItemProps) {
  return (
    <RadioItem value={value} onSelect={onSelect} disabled={disabled} className={ITEM}>
      {children}
      <span className="flex size-3.5 shrink-0">
        <ItemIndicator>
          <Icon name="Check" className="size-3.5" aria-hidden />
        </ItemIndicator>
      </span>
    </RadioItem>
  );
}
