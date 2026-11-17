import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaneFocusProvider, PaneProvider, type PaneContextValue } from "@/panels/pane-context";
import { dismissPreviewOnEscape, useDismissMediaPreviewOnEscape } from "./dismiss-preview";
import type { KeyboardInputEvent } from "@/keyboard";

function escapeInput(overrides: Partial<KeyboardInputEvent> = {}): KeyboardInputEvent {
  return {
    key: "Escape",
    code: "Escape",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    preventDefault() {},
    stopPropagation() {},
    ...overrides,
  };
}

describe("dismissPreviewOnEscape", () => {
  it("dismisses a bare Escape and leaves modified escapes alone", () => {
    const dismiss = vi.fn();
    expect(dismissPreviewOnEscape(escapeInput(), dismiss)).toBe(true);
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(dismissPreviewOnEscape(escapeInput({ shiftKey: true }), dismiss)).toBe(false);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});

const pane: PaneContextValue = {
  serverId: "host",
  workspaceId: "workspace",
  host: "main",
  tabId: "tab",
  target: { kind: "files" },
  openTab() {},
  openPreferredTarget() {},
  closeCurrentTab() {},
  retargetCurrentTab() {},
  setCurrentTabState() {},
  openFileInWorkspace() {},
  openImportSheet() {},
};

const focusedPane = {
  isWorkspaceFocused: true,
  isPaneFocused: true,
  isInteractive: true,
  focusPane() {},
};

const backgroundPane = {
  isWorkspaceFocused: false,
  isPaneFocused: false,
  isInteractive: false,
  focusPane() {},
};

function Harness({
  active,
  interactive,
  onDismiss,
}: {
  active: boolean;
  interactive: boolean;
  onDismiss: () => void;
}) {
  return (
    <PaneProvider value={pane}>
      <PaneFocusProvider value={interactive ? focusedPane : backgroundPane}>
        <PreviewProbe active={active} onDismiss={onDismiss} />
      </PaneFocusProvider>
    </PaneProvider>
  );
}

function PreviewProbe({ active, onDismiss }: { active: boolean; onDismiss: () => void }) {
  useDismissMediaPreviewOnEscape(active, onDismiss);
  return null;
}

describe("useDismissMediaPreviewOnEscape", () => {
  let root: Root | null = null;

  beforeEach(() => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    dom.window.requestAnimationFrame = vi.fn(() => 1);
    dom.window.cancelAnimationFrame = vi.fn();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
    vi.stubGlobal("Node", dom.window.Node);
    vi.stubGlobal("navigator", dom.window.navigator);
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    vi.unstubAllGlobals();
  });

  it("closes the open preview when Escape is pressed in that pane", () => {
    const onDismiss = vi.fn();
    act(() => {
      root?.render(<Harness active interactive onDismiss={onDismiss} />);
    });

    act(() => {
      window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("leaves Escape alone when the preview is closed or the pane is not in front", () => {
    const onDismiss = vi.fn();
    act(() => {
      root?.render(<Harness active={false} interactive onDismiss={onDismiss} />);
    });
    act(() => {
      window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    act(() => {
      root?.render(<Harness active interactive={false} onDismiss={onDismiss} />);
    });
    act(() => {
      window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(onDismiss).not.toHaveBeenCalled();
  });
});
