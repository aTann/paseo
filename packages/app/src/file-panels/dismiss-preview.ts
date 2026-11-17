import { useOverlayRegistration, type KeyboardInputEvent } from "@/keyboard";
import { useOverlayLayer } from "@/lib/overlay-root";
import { useOptionalPaneContext, useOptionalPaneFocus } from "@/panels/pane-context";
import { useRef } from "react";

/** Escape dismisses the open media preview while this pane is the one in front. */
export function useDismissMediaPreviewOnEscape(active: boolean, dismiss: () => void): void {
  const pane = useOptionalPaneContext();
  const focus = useOptionalPaneFocus();
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  const layer = useOverlayLayer("floating");
  useOverlayRegistration({
    keys: ["Escape"],
    active: active && pane !== null && focus?.isInteractive === true,
    layer,
    manageFocus: false,
    onKeyDown: (event) => dismissPreviewOnEscape(event, () => dismissRef.current()),
  });
}

export function dismissPreviewOnEscape(event: KeyboardInputEvent, dismiss: () => void): boolean {
  if (event.key !== "Escape" || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  dismiss();
  return true;
}
