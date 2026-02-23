/**
 * ConfirmDialog — Global confirmation dialog driven by useDialogStore.
 *
 * Mount once at the app root (Shell). Components trigger it via:
 *   const confirmed = await useDialogStore.getState().confirm({ ... });
 */

import { useDialogStore } from '@/ui/stores/useDialogStore';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function ConfirmDialog() {
  const open = useDialogStore((s) => s.open);
  const { title, description, confirmLabel, cancelLabel, variant } = useDialogStore((s) => s.options);
  const respond = useDialogStore((s) => s.respond);

  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) respond(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            {cancelLabel ?? 'Cancel'}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => respond(true)}
            className={
              variant === 'destructive'
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : undefined
            }
          >
            {confirmLabel ?? 'Confirm'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
