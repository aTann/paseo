import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const indexHtml = readFileSync(new URL("../../../public/index.html", import.meta.url), "utf8");

describe("window chrome no-drag backstop", () => {
  it("scopes Electron no-drag to window chrome so scrolled content cannot punch the titlebar", () => {
    const match = indexHtml.match(
      /\[data-window-chrome\] button,[\s\S]*?-webkit-app-region:\s*no-drag !important;/,
    );
    expect(match).not.toBeNull();
    const rule = match![0];
    const selectors = rule
      .slice(0, rule.indexOf("{"))
      .split(",")
      .map((selector) => selector.trim())
      .filter((selector) => selector.length > 0);
    expect(selectors.length).toBeGreaterThan(1);
    for (const selector of selectors) {
      expect(selector.startsWith("[data-window-chrome] ")).toBe(true);
    }
  });
});
