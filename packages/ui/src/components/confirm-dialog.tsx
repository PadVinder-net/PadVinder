import { FieldError, pendingLabel } from "./login/form-parts";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  text: string;
  confirmLabel: string;
  destructive?: boolean;
  pending?: boolean;
  /** A message from the server, in Dutch; shown inside the dialog so the user sees why. */
  error?: string;
  onConfirm(): void;
  onCancel(): void;
};

export function ConfirmDialog({
  open,
  title,
  text,
  confirmLabel,
  destructive,
  pending,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-xl">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-lg text-foreground">
            {text}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <FieldError id="confirm-dialog-error" message={error} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} className="h-14 text-lg">
            Annuleer
          </AlertDialogCancel>
          <Button
            size="lg"
            variant={destructive ? "destructive" : "default"}
            className="h-14 text-lg"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
