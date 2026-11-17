import { describe, expect, it } from "vitest";
import {
  FRAME_SHORTCUT_INPUT_CHANNEL,
  type FrameCloseKey,
  installFrameCloseShortcutRedirect,
} from "./frame-close-shortcut.js";

const ctrlW: FrameCloseKey = {
  alt: false,
  code: "KeyW",
  control: true,
  isAutoRepeat: false,
  key: "w",
  meta: false,
  shift: false,
  type: "keyDown",
};

class FakeContents {
  public focused = true;
  public focusedFrame: { parent: object | null } | null = { parent: {} };
  public readonly prevented: boolean[] = [];
  public readonly sent: Array<{ channel: string; payload: unknown }> = [];
  private listener: ((event: { preventDefault(): void }, input: FrameCloseKey) => void) | null =
    null;

  public isFocused(): boolean {
    return this.focused;
  }

  public on(
    event: "before-input-event",
    listener: (event: { preventDefault(): void }, input: FrameCloseKey) => void,
  ): void {
    expect(event).toBe("before-input-event");
    this.listener = listener;
  }

  public send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload });
  }

  public press(key: FrameCloseKey): void {
    let prevented = false;
    this.listener?.(
      {
        preventDefault() {
          prevented = true;
        },
      },
      key,
    );
    this.prevented.push(prevented);
  }
}

function install(platform: string): FakeContents {
  const contents = new FakeContents();
  installFrameCloseShortcutRedirect(contents, platform);
  return contents;
}

describe("installFrameCloseShortcutRedirect", () => {
  it("hands Ctrl+W in a child frame to the host instead of the window menu", () => {
    const contents = install("linux");

    contents.press(ctrlW);

    expect(contents.prevented).toEqual([true]);
    expect(contents.sent).toEqual([
      {
        channel: FRAME_SHORTCUT_INPUT_CHANNEL,
        payload: {
          alt: false,
          code: "KeyW",
          control: true,
          key: "w",
          meta: false,
          repeat: false,
          shift: false,
        },
      },
    ]);
  });

  it("leaves Ctrl+W on the host page when the main frame is focused", () => {
    const contents = install("linux");
    contents.focusedFrame = { parent: null };

    contents.press(ctrlW);

    expect(contents.prevented).toEqual([false]);
    expect(contents.sent).toEqual([]);
  });

  it("leaves Ctrl+W alone when no frame is focused", () => {
    const contents = install("linux");
    contents.focusedFrame = null;

    contents.press(ctrlW);

    expect(contents.prevented).toEqual([false]);
    expect(contents.sent).toEqual([]);
  });

  it("leaves Ctrl+W alone when the window is not focused", () => {
    const contents = install("linux");
    contents.focused = false;

    contents.press(ctrlW);

    expect(contents.prevented).toEqual([false]);
    expect(contents.sent).toEqual([]);
  });

  it("does not treat a key release or a shifted W as closing the window", () => {
    const contents = install("linux");

    contents.press({ ...ctrlW, type: "keyUp" });
    contents.press({ ...ctrlW, shift: true, key: "W" });

    expect(contents.prevented).toEqual([false, false]);
    expect(contents.sent).toEqual([]);
  });

  it("hands Escape in a child frame to the host so a preview can dismiss", () => {
    const contents = install("linux");

    contents.press({
      alt: false,
      code: "Escape",
      control: false,
      isAutoRepeat: false,
      key: "Escape",
      meta: false,
      shift: false,
      type: "keyDown",
    });
    contents.press({
      alt: false,
      code: "Escape",
      control: true,
      isAutoRepeat: false,
      key: "Escape",
      meta: false,
      shift: false,
      type: "keyDown",
    });

    expect(contents.prevented).toEqual([true, false]);
    expect(contents.sent).toEqual([
      {
        channel: FRAME_SHORTCUT_INPUT_CHANNEL,
        payload: {
          alt: false,
          code: "Escape",
          control: false,
          key: "Escape",
          meta: false,
          repeat: false,
          shift: false,
        },
      },
    ]);
  });

  it("uses Cmd+W for a child frame on macOS and ignores Ctrl+W", () => {
    const contents = install("darwin");

    contents.press(ctrlW);
    contents.press({ ...ctrlW, control: false, meta: true });

    expect(contents.prevented).toEqual([false, true]);
    expect(contents.sent).toEqual([
      {
        channel: FRAME_SHORTCUT_INPUT_CHANNEL,
        payload: {
          alt: false,
          code: "KeyW",
          control: false,
          key: "w",
          meta: true,
          repeat: false,
          shift: false,
        },
      },
    ]);
  });
});
