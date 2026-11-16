import { describe, expect, it } from "vitest";
import { resolveKeyboardShortcut } from "../../keyboard-shortcuts";
import { frameShortcutKeyboardEvent } from "./frame-shortcut";

const ctrlW = {
  alt: false,
  code: "KeyW",
  control: true,
  key: "w",
  meta: false,
  repeat: false,
  shift: false,
};

function resolve(value: unknown, isMac: boolean) {
  const event = frameShortcutKeyboardEvent(value);
  if (!event) return null;
  return (
    resolveKeyboardShortcut({
      event,
      context: {
        commandCenterOpen: false,
        focusScope: "other",
        isMac,
        usesDesktopBindings: true,
      },
      chordState: { candidateIndices: [], step: 0, timeoutId: null },
      onChordReset: () => undefined,
    }).match?.action ?? null
  );
}

describe("frameShortcutKeyboardEvent", () => {
  it("closes the current tab when a child frame forwards Ctrl+W", () => {
    expect(resolve(ctrlW, false)).toBe("workspace.tab.close.current");
  });

  it("closes the current tab when a child frame forwards Cmd+W on macOS", () => {
    expect(resolve({ ...ctrlW, control: false, meta: true }, true)).toBe(
      "workspace.tab.close.current",
    );
  });

  it("ignores a payload that is not a shortcut", () => {
    expect(frameShortcutKeyboardEvent(null)).toBeNull();
    expect(frameShortcutKeyboardEvent({ ...ctrlW, control: "yes" })).toBeNull();
    expect(resolve(ctrlW, true)).toBeNull();
  });
});
