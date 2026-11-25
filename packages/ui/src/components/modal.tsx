import type { ReactNode } from "react";
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from "./ui/dialog";

export type ModalProps = {
  open: boolean;
  title: string;
  onClose(): void;
  /** The content brings its own buttons; the modal has no button row. */
  children: ReactNode;
};

/**
 * A dialog for forms and details, with a cross in its corner. It closes through the cross,
 * the Escape key and a click beside it. For a question with two buttons, use ConfirmDialog.
 */
export function Modal({ open, title, onClose, children }: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        showCloseButton={false}
        // No description: the title names the dialog and the content speaks for itself.
        aria-describedby={undefined}
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 p-0"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 py-3 pr-3 pl-6">
          <DialogTitle className="pt-2.5 text-xl leading-snug">{title}</DialogTitle>
          <DialogCloseButton />
        </div>
        <div className="min-h-0 overflow-y-auto px-6 pb-6">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
