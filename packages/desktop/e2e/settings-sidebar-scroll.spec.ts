import { test, expect } from "../../app/e2e/support/fixtures";
import { gotoAppShell, openSettings } from "../../app/e2e/support/helpers/app";

test.describe("Settings sidebar scrolling", () => {
  test.use({ viewport: { width: 900, height: 260 } });

  test("desktop drag region does not cover the scroll body", async ({ page }) => {
    await page.addInitScript(() => {
      window.paseoDesktop = {
        platform: "darwin",
        events: { on: () => () => {} },
        invoke: async (command: string) => {
          if (command === "get_desktop_settings") {
            return {
              releaseChannel: "stable",
              daemon: { manageBuiltInDaemon: true, keepRunningAfterQuit: true },
            };
          }
          return null;
        },
      };
    });

    await gotoAppShell(page);
    await openSettings(page);

    const sidebar = page.getByTestId("settings-sidebar");
    const scrollBody = page.getByTestId("settings-sidebar-scroll-body");
    await expect(sidebar).toBeVisible();
    await expect(scrollBody).toBeVisible();

    const geometry = await sidebar.evaluate((node) => {
      const scrollBodyElement = node.querySelector<HTMLElement>(
        '[data-testid="settings-sidebar-scroll-body"]',
      );
      if (!scrollBodyElement) return null;

      const scrollerRect = scrollBodyElement.getBoundingClientRect();
      const dragRegions = [];
      for (const element of node.querySelectorAll<HTMLElement>("*")) {
        if (getComputedStyle(element).getPropertyValue("-webkit-app-region") === "drag") {
          const rect = element.getBoundingClientRect();
          dragRegions.push({ bottom: rect.bottom });
        }
      }

      return {
        scrollBodyTop: scrollerRect.top,
        dragRegions,
      };
    });

    expect(geometry).not.toBeNull();
    expect(geometry!.dragRegions).not.toEqual([]);
    for (const dragRegion of geometry!.dragRegions) {
      expect(dragRegion.bottom).toBeLessThanOrEqual(geometry!.scrollBodyTop + 1);
    }
  });

  test("scrolling settings does not punch no-drag holes in the titlebar", async ({ page }) => {
    await page.addInitScript(() => {
      window.paseoDesktop = {
        platform: "darwin",
        events: { on: () => () => {} },
        invoke: async (command: string) => {
          if (command === "get_desktop_settings") {
            return {
              releaseChannel: "stable",
              daemon: { manageBuiltInDaemon: true, keepRunningAfterQuit: true },
            };
          }
          return null;
        },
      };
    });

    await gotoAppShell(page);
    await openSettings(page);

    const sidebar = page.getByTestId("settings-sidebar");
    const scrollBody = page.getByTestId("settings-sidebar-scroll-body");
    await expect(sidebar).toBeVisible();
    await expect(scrollBody).toBeVisible();

    await scrollBody.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });

    const result = await page.evaluate(() => {
      const regions: Array<{ mode: string; x: number; y: number; w: number; h: number }> = [];
      const walk = (el: Element) => {
        const mode = getComputedStyle(el).getPropertyValue("-webkit-app-region").trim();
        if (mode === "drag" || mode === "no-drag") {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            regions.push({
              mode,
              x: rect.left,
              y: rect.top,
              w: rect.width,
              h: rect.height,
            });
          }
        }
        for (const child of el.children) {
          walk(child);
        }
      };
      walk(document.body);

      let overlay: HTMLElement | null = null;
      const candidates = document.querySelectorAll<HTMLElement>("*");
      for (const el of candidates) {
        if (getComputedStyle(el).getPropertyValue("-webkit-app-region") === "drag") {
          overlay = el;
          break;
        }
      }
      if (!overlay) {
        return { caption: false, hasOverlay: false };
      }
      const overlayRect = overlay.getBoundingClientRect();
      const x = overlayRect.left + overlayRect.width / 2;
      const y = overlayRect.top + Math.min(8, overlayRect.height / 2);
      let hasDrag = false;
      let hasNoDrag = false;
      for (const region of regions) {
        if (x >= region.x && x < region.x + region.w && y >= region.y && y < region.y + region.h) {
          if (region.mode === "drag") hasDrag = true;
          if (region.mode === "no-drag") hasNoDrag = true;
        }
      }
      const caption = hasDrag && !hasNoDrag;
      return { caption, hasOverlay: true };
    });

    expect(result.hasOverlay).toBe(true);
    expect(result.caption).toBe(true);
  });
});
