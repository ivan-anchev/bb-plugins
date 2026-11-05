import type { ReactNode } from "react";
import { Content, Item, CheckboxItem, ItemIndicator, Label, Portal, Root, Separator, Trigger } from "@radix-ui/react-dropdown-menu";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";

declare const __BB_PLUGIN_ID__: string;

const PORTAL_SCOPE = { "data-bb-portaled-overlay": "", "data-bb-plugin-root": "", "data-bb-plugin": __BB_PLUGIN_ID__ };

const ITEM_CLASSES =
  "relative flex cursor-default select-none items-center rounded-sm py-[0.3125rem] text-xs outline-none transition-none focus:bg-state-hover focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

export { Root as Menu, Trigger as MenuTrigger };

type MenuContentProps = { align: "start" | "end"; className?: string; children: ReactNode };

export function MenuContent({ align, className = "", children }: MenuContentProps) {
  return (
    <Portal>
      <Content
        {...PORTAL_SCOPE}
        align={align}
        sideOffset={4}
        className={`z-50 min-w-28 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 ${className}`}
      >
        {children}
      </Content>
    </Portal>
  );
}

type MenuItemProps = { onSelect(): void; disabled?: boolean; children: ReactNode };

export function MenuItem({ onSelect, disabled = false, children }: MenuItemProps) {
  return (
    <Item onSelect={onSelect} disabled={disabled} className={`${ITEM_CLASSES} justify-between gap-2 px-2`}>
      {children}
    </Item>
  );
}

type MenuCheckboxItemProps = {
  checked: boolean;
  onCheckedChange(checked: boolean): void;
  keepOpen?: boolean;
  children: ReactNode;
};

export function MenuCheckboxItem({ checked, onCheckedChange, keepOpen = false, children }: MenuCheckboxItemProps) {
  return (
    <CheckboxItem
      checked={checked}
      onCheckedChange={onCheckedChange}
      onSelect={(event) => {
        if (keepOpen) event.preventDefault();
      }}
      className={`${ITEM_CLASSES} pl-2 pr-8`}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <ItemIndicator>
          <Icon name="Check" className="size-3.5" aria-hidden />
        </ItemIndicator>
      </span>
      {children}
    </CheckboxItem>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <Label className="px-2 py-[0.3125rem] text-xs font-medium text-muted-foreground">{children}</Label>;
}

export function MenuSeparator() {
  return <Separator className="-mx-1 my-1 h-px bg-muted" />;
}

export function MenuCheck({ shown }: { shown: boolean }) {
  return <Icon name="Check" className={`size-3.5 shrink-0 ${shown ? "opacity-100" : "opacity-0"}`} aria-hidden />;
}
