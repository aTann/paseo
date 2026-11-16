// Renderer subscribes as `frame-shortcut-input`. The preload prefixes `paseo:event:`.
export const FRAME_SHORTCUT_INPUT_CHANNEL = "paseo:event:frame-shortcut-input";

export interface FrameCloseKey {
  alt: boolean;
  code: string;
  control: boolean;
  isAutoRepeat: boolean;
  key: string;
  meta: boolean;
  shift: boolean;
  type: string;
}

export interface FrameCloseTarget {
  parent: unknown;
}

export interface FrameShortcutPayload {
  alt: boolean;
  code: string;
  control: boolean;
  key: string;
  meta: boolean;
  repeat: boolean;
  shift: boolean;
}

export interface FrameCloseShortcutContents {
  focusedFrame: FrameCloseTarget | null;
  isFocused(): boolean;
  on(
    event: "before-input-event",
    listener: (event: { preventDefault(): void }, input: FrameCloseKey) => void,
  ): void;
  send(channel: string, payload: FrameShortcutPayload): void;
}

export function frameCloseShortcutPayload(key: FrameCloseKey): FrameShortcutPayload {
  return {
    alt: key.alt,
    code: key.code,
    control: key.control,
    key: key.key,
    meta: key.meta,
    repeat: key.isAutoRepeat,
    shift: key.shift,
  };
}

export function shouldRedirectFrameCloseShortcut(input: {
  contentsFocused: boolean;
  focusedFrame: FrameCloseTarget | null;
  key: FrameCloseKey;
  platform: string;
}): boolean {
  if (!input.contentsFocused) return false;
  if (input.focusedFrame === null || input.focusedFrame.parent === null) return false;
  return isWindowCloseShortcut(input.key, input.platform);
}

function isWindowCloseShortcut(key: FrameCloseKey, platform: string): boolean {
  if (key.type !== "keyDown" || key.code !== "KeyW" || key.alt || key.shift) return false;
  if (platform === "darwin") return key.meta && !key.control;
  return key.control && !key.meta;
}

// The Window menu's Close item owns Ctrl+W (Cmd+W on macOS). A focused child
// frame, such as the HTML preview, never delivers that key to the host page, so
// the menu closes the window. Take it back and let the host close the tab.
export function installFrameCloseShortcutRedirect(
  contents: FrameCloseShortcutContents,
  platform: string = process.platform,
): void {
  contents.on("before-input-event", (event, key) => {
    if (
      !shouldRedirectFrameCloseShortcut({
        contentsFocused: contents.isFocused(),
        focusedFrame: contents.focusedFrame,
        key,
        platform,
      })
    ) {
      return;
    }
    event.preventDefault();
    contents.send(FRAME_SHORTCUT_INPUT_CHANNEL, frameCloseShortcutPayload(key));
  });
}
