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
  return isWindowCloseShortcut(input.key, input.platform) || isPreviewDismissKey(input.key);
}

function isWindowCloseShortcut(key: FrameCloseKey, platform: string): boolean {
  if (key.type !== "keyDown" || key.code !== "KeyW" || key.alt || key.shift) return false;
  if (platform === "darwin") return key.meta && !key.control;
  return key.control && !key.meta;
}

function isPreviewDismissKey(key: FrameCloseKey): boolean {
  return (
    key.type === "keyDown" &&
    key.code === "Escape" &&
    !key.alt &&
    !key.control &&
    !key.meta &&
    !key.shift
  );
}

// A focused child frame, such as an HTML or document preview, never delivers
// keys to the host page. Ctrl+W would close the window through the Window menu,
// and Escape would never dismiss the preview. Take both back.
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
