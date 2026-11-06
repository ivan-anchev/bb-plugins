// A click-opened popover in bb's overlay layer (Radix Popover, shimmed by the host). Radix moves
// focus into it on open and back to the trigger on close; Escape and a click outside close it,
// and Radix claims the Escape (preventDefault), so bb does not also act on it.
import type { ReactNode } from "react";
import { Content, Portal, Root, Trigger } from "@radix-ui/react-popover";
import { PORTAL_SCOPE } from "./portal-scope.ts";

export { Root as Popover, Trigger as PopoverTrigger };

type PopoverContentProps = { label: string; children: ReactNode };

export function PopoverContent({ label, children }: PopoverContentProps) {
  return (
    <Portal>
      <Content
        {...PORTAL_SCOPE}
        aria-label={label}
        align="end"
        sideOffset={4}
        className="z-50 grid w-60 rounded-lg bg-popover p-1.5 text-popover-foreground shadow-md ring-1 ring-foreground/8 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 motion-reduce:animate-none"
      >
        {children}
      </Content>
    </Portal>
  );
}
