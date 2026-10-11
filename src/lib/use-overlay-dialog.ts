import { useLayoutEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

import { closeOverlay, getUi, useUi } from "#/lib/ui";
import type { Overlay } from "#/lib/ui";

/**
 * A native modal `<dialog>` that follows one overlay of the ui store. The
 * store opens and closes it; Escape and a click on the backdrop close it and
 * tell the store. The browser keeps the focus inside and gives it back.
 */
export function useOverlayDialog(name: Overlay) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = useUi((state) => state.overlay === name);
  /** The press started on the backdrop: a drag out of the dialog is not a click on it. */
  const pressedBackdrop = useRef(false);

  // A layout effect: the dialog is on screen before the effects of its
  // children (and of its owner) measure anything or move the focus.
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return {
    ref,
    open,
    dialogProps: {
      ref,
      // The browser closed it (Escape): the store has to know. A `close` that
      // arrives after a reopen is old news.
      onClose: (event: { currentTarget: HTMLDialogElement }) => {
        if (!event.currentTarget.open && getUi().overlay === name) closeOverlay();
      },
      onPointerDown: (event: ReactPointerEvent<HTMLDialogElement>) => {
        pressedBackdrop.current = event.target === event.currentTarget;
      },
      onClick: (event: ReactMouseEvent<HTMLDialogElement>) => {
        if (pressedBackdrop.current && event.target === event.currentTarget) closeOverlay();
        pressedBackdrop.current = false;
      },
    },
  };
}
