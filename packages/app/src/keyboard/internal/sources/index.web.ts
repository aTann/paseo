import { getDesktopHost } from "@/desktop/host";
import { getResidentBrowserWebview } from "@/desktop/browser/resident-webviews";
import { setCommandCenterFocusRestoreElement } from "@/utils/command-center-focus-restore";
import { buildBrowserKeyboardPolicy, attachElectronBrowserSource } from "./electron-browser";
import { attachDomKeyboardSource } from "./dom.web";
import { attachFrameShortcutSource } from "./frame-shortcut";
import type { KeyboardSourceHandlers } from "./contract";
export function attachKeyboardSources(handlers: KeyboardSourceHandlers): () => void {
  const detachDom = attachDomKeyboardSource(handlers);
  const host = getDesktopHost();
  const subscribeGuest = host?.events?.on;
  const detachGuest = subscribeGuest
    ? attachElectronBrowserSource(
        {
          subscribe: (handler) => subscribeGuest("browser-shortcut-input", handler),
          captureFocusRestore: (browserId) =>
            setCommandCenterFocusRestoreElement(getResidentBrowserWebview(browserId)),
        },
        handlers,
      )
    : () => {};
  const detachFrame = subscribeGuest ? attachFrameShortcutSource(subscribeGuest) : () => {};
  return () => {
    detachDom();
    detachGuest();
    detachFrame();
  };
}
export function publishKeyboardPolicy(input: import("./contract").KeyboardPolicyInput): void {
  const policy = input.enabled
    ? buildBrowserKeyboardPolicy(input)
    : { menuPrefixes: [], prefixes: [] };
  void getDesktopHost()?.browser?.setShortcutPolicy?.(policy);
}
