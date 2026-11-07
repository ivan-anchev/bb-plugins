import type { ReactNode } from "react";
import { Content, Item, Portal, Root, Trigger } from "@radix-ui/react-dropdown-menu";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { PORTAL_SCOPE } from "./portal-scope.ts";

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

type MenuItemProps = { onSelect(): void; children: ReactNode };

export function MenuItem({ onSelect, children }: MenuItemProps) {
  return (
    <Item
      onSelect={onSelect}
      className="relative flex cursor-default select-none items-center justify-between gap-2 rounded-sm px-2 py-[0.3125rem] text-xs outline-none transition-none focus:bg-state-hover focus:text-foreground"
    >
      {children}
    </Item>
  );
}

export function MenuCheck({ shown }: { shown: boolean }) {
  return <Icon name="Check" className={`size-3.5 shrink-0 ${shown ? "opacity-100" : "opacity-0"}`} aria-hidden />;
}
