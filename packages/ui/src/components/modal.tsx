import { useRef, type ReactNode } from "react";
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
 *
 * On opening, focus goes to the dialog itself, not to its first button (Radix's default): a
 * modal that opens without a tap, such as the passkey confirmation after a failed request, would
 * otherwise show the cross with a focus ring. The title is announced, and Tab reaches the cross
 * first.
 */
export function Modal({ open, title, onClose, children }: ModalProps) {
  const content = useRef<HTMLDivElement>(null);
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        ref={content}
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          content.current?.focus();
        }}
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
