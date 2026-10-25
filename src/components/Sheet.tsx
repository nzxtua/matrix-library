import { useEffect, useId, useLayoutEffect, useState } from "react";

import { Comfort } from "#/components/Comfort";
import { IconLightsOut, IconRuler, IconSearch, IconTorch, Ring } from "#/components/Dock";
import { Icon, IconClose, Keycaps } from "#/components/Keymap";
import { SectionNav } from "#/components/SectionNav";
import { copy } from "#/lib/copy";
import { TOOL_KEYS } from "#/lib/hotkeys";
import type { MarkdownDocument } from "#/lib/markdown";
import { useReadPercent } from "#/lib/reading";
import { closeOverlay, openOverlay, setRuler, setTorch, useUi } from "#/lib/ui";
import { useOverlayDialog } from "#/lib/use-overlay-dialog";

/** The content stays this long after the sheet closes: it fades with it. */
const LINGER_MS = 320;

/**
 * The bottom sheet of a phone: what the panel holds on a desktop. The tool
 * buttons, the sections, and the comfort settings behind one row.
 *
 * A native modal `<dialog>`: the browser keeps the focus inside, closes it on
 * Escape and gives the focus back to the bar.
 */
export function Sheet({ document: doc }: { document: MarkdownDocument }) {
  const { ref, open, dialogProps } = useOverlayDialog("sheet");
  const ruler = useUi((state) => state.ruler);
  const torch = useUi((state) => state.torch);
  const percent = useReadPercent();
  const titleId = useId();

  // The content exists only while the sheet is open, and while it fades.
  // A closed sheet does not follow the reader through the sections.
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open || !mounted) return;
    const timer = window.setTimeout(() => setMounted(false), LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  // The sheet opens with the current section in the middle of the list.
  useLayoutEffect(() => {
    if (!open) return;
    const current = ref.current?.querySelector<HTMLElement>(".section-nav [aria-current]");
    const list = current?.closest<HTMLElement>(".section-nav");
    if (!current || !list) return;
    const box = list.getBoundingClientRect();
    const item = current.getBoundingClientRect();
    list.scrollTop += item.top - box.top - (box.height - item.height) / 2;
  }, [open, ref]);

  return (
    <dialog {...dialogProps} className="sheet" aria-labelledby={titleId}>
      {mounted && (
        <div className="sheet__body">
          <header className="sheet__head">
            <h2 id={titleId} className="sheet__title">
              {copy.labels.menu}
            </h2>
            <span className="sheet__read" role="img" aria-label={copy.labels.progress(percent)}>
              <Ring percent={percent} />
              <span aria-hidden="true">{copy.labels.progress(percent)}</span>
            </span>
            <button
              type="button"
              className="dialog-close"
              aria-label={copy.labels.close}
              onClick={closeOverlay}
            >
              <IconClose />
            </button>
          </header>

          <div className="sheet__tools" role="group" aria-label={copy.labels.tools}>
            <button
              type="button"
              className="sheet__tool"
              aria-haspopup="dialog"
              onClick={() => openOverlay("spotlight")}
            >
              <IconSearch />
              {copy.labels.search}
            </button>
            <button
              type="button"
              className="sheet__tool"
              aria-pressed={ruler}
              onClick={() => {
                setRuler(!ruler);
                closeOverlay();
              }}
            >
              <IconRuler />
              {copy.labels.ruler}
            </button>
            <button
              type="button"
              className="sheet__tool"
              aria-pressed={torch}
              onClick={() => {
                setTorch(!torch);
                closeOverlay();
              }}
            >
              <IconTorch />
              {copy.labels.torch}
            </button>
            <button type="button" className="sheet__tool" onClick={() => openOverlay("curtain")}>
              <IconLightsOut />
              {copy.labels.lightsOut}
            </button>
            <button
              type="button"
              className="sheet__tool sheet__tool--keys"
              aria-haspopup="dialog"
              onClick={() => openOverlay("keymap")}
            >
              <Keycaps keys={TOOL_KEYS.keys} />
              {copy.labels.keys}
            </button>
          </div>

          <SectionNav document={doc} onNavigate={closeOverlay} />

          <details className="sheet__comfort">
            <summary>
              <span className="sheet__lamp" aria-hidden="true" />
              <span className="sheet__comfort-name">
                {copy.comfort.light} · {copy.comfort.text} · {copy.comfort.motion}
              </span>
              <Icon>
                <path d="m6 8 4 4 4-4" />
              </Icon>
            </summary>
            <div className="sheet__comfort-body">
              <Comfort />
            </div>
          </details>
        </div>
      )}
    </dialog>
  );
}
