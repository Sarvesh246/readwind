"use client";

import { DropdownMenu } from "radix-ui";
import { Ellipsis } from "lucide-react";
import type { ReactNode } from "react";

export function ActionMenu({
  label,
  triggerClassName,
  children,
}: {
  label: string;
  triggerClassName: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger className={triggerClassName} aria-label={label} title={label}>
        <Ellipsis size={19} aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="action-menu"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          onCloseAutoFocus={(event) => {
            if (document.activeElement?.closest("dialog:modal")) event.preventDefault();
          }}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
