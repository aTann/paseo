import type { KeyboardShortcutInput } from "../../keyboard-shortcuts";

// Desktop `installFrameCloseShortcutRedirect` sends this when the window-close
// shortcut lands in a child frame. The preload names the channel without its
// `paseo:event:` prefix.
const FRAME_SHORTCUT_INPUT_EVENT = "frame-shortcut-input";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function frameShortcutKeyboardEvent(value: unknown): KeyboardShortcutInput | null {
  if (!isRecord(value)) return null;
  const { alt, code, control, key, meta, repeat, shift } = value;
  const keysAreStrings = typeof key === "string" && typeof code === "string";
  const modifiersAreBooleans =
    typeof alt === "boolean" &&
    typeof control === "boolean" &&
    typeof meta === "boolean" &&
    typeof shift === "boolean" &&
    typeof repeat === "boolean";
  if (!keysAreStrings || !modifiersAreBooleans) return null;
  return {
    key,
    code,
    altKey: alt,
    ctrlKey: control,
    metaKey: meta,
    shiftKey: shift,
    repeat,
  };
}

export function attachFrameShortcutSource(
  subscribe: (
    event: string,
    handler: (payload: unknown) => void,
  ) => (() => void) | Promise<() => void>,
): () => void {
  const subscription = subscribe(FRAME_SHORTCUT_INPUT_EVENT, (payload) => {
    const shortcut = frameShortcutKeyboardEvent(payload);
    if (!shortcut || typeof KeyboardEvent === "undefined") return;
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        ...shortcut,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  return () => {
    if (typeof subscription === "function") subscription();
    else void subscription.then((dispose) => dispose());
  };
}
