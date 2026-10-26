import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

interface OverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}

/** A centred modal for one short decision or form. */
export function Modal({ open, onOpenChange, title, description, children }: OverlayProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-[18vh] z-50 w-[min(480px,calc(100vw-32px))] -translate-x-1/2 rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-2xl">
          <Dialog.Title className="text-lg font-semibold tracking-tight">{title}</Dialog.Title>
          {description && <Dialog.Description className="mt-1 text-[13px] text-muted">{description}</Dialog.Description>}
          <div className="mt-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A panel from the right for details that would crowd the screen. */
export function Drawer({ open, onOpenChange, title, description, children }: OverlayProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/10" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-[min(880px,100vw)] flex-col border-l border-line bg-surface shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-lg font-semibold tracking-tight">{title}</Dialog.Title>
              {description && <Dialog.Description className="mt-0.5 text-[13px] text-muted">{description}</Dialog.Description>}
            </div>
            <Dialog.Close className="rounded-full px-2 text-xl leading-none text-muted hover:text-ink" aria-label="Close">
              ×
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
