import { useEffect, useRef } from "react";

import { useToast } from "#/lib/toast";
import type { ToastMessage } from "#/lib/toast";

/**
 * The one polite live region of the page. `toast(text)` from `lib/toast.ts`
 * shows a line here for a moment. Styles: `.toast` in `styles/tokens.css`.
 *
 * The line is a manual popover, so it lives in the top layer. While a modal
 * dialog is open (the sheet, the search), a new message raises it again, so
 * it shows above that dialog and not under its backdrop.
 */
export function Toast() {
  const message = useToast();
  const ref = useRef<HTMLDivElement>(null);
  // The last message stays in place while the line fades out.
  const last = useRef<ToastMessage | null>(null);
  if (message) last.current = message;
  const shown = last.current;

  // Open from the start, so the live region exists before the first message.
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof element.showPopover !== "function") return;
    // Raise it only above a modal that opened after it: a hide and show skips the fade.
    const under = message && document.querySelector("dialog:modal") !== null;
    if (under && element.matches(":popover-open")) element.hidePopover();
    if (!element.matches(":popover-open")) element.showPopover();
  }, [message]);

  return (
    <div
      ref={ref}
      className="toast"
      popover="manual"
      role="status"
      aria-live="polite"
      data-show={message ? "" : undefined}
    >
      {/* A new key is a new node: a screen reader says the same text again. */}
      {shown && <span key={shown.id}>{shown.text}</span>}
    </div>
  );
}
