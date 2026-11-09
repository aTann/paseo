import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Pressable, Text, View } from "react-native";
import { NewWorkspaceCanvas } from "./new-workspace-canvas";

vi.mock("@/constants/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/constants/platform")>();
  return { ...actual, getIsElectron: () => true };
});

beforeEach(() => vi.stubGlobal("React", React));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function dragRectanglesCover(testId: string): boolean {
  const field = document.querySelector(`[data-testid="${testId}"]`);
  if (!(field instanceof HTMLElement)) return true;
  const bounds = field.getBoundingClientRect();
  const x = Math.min(Math.max(bounds.left + 12, 0), window.innerWidth - 1);
  const y = Math.min(Math.max(bounds.top + 8, 0), window.innerHeight - 1);
  return [...document.querySelectorAll("div")].some((element) => {
    if (getComputedStyle(element).getPropertyValue("-webkit-app-region").trim() !== "drag") {
      return false;
    }
    const drag = element.getBoundingClientRect();
    return x >= drag.left && x <= drag.right && y >= drag.top && y <= drag.bottom;
  });
}

const frameStyle = { width: 900, height: 700 };
const projectFieldStyle = { height: 44, width: 240 };
const composerFieldStyle = { height: 88, marginTop: 24 };

describe("new workspace window dragging", () => {
  it("lets the setup fields and composer receive clicks on desktop", () => {
    act(() => {
      root.render(
        <View style={frameStyle}>
          <NewWorkspaceCanvas>
            <Pressable testID="new-workspace-project-field" style={projectFieldStyle}>
              <Text>Project</Text>
            </Pressable>
            <View testID="new-workspace-composer-field" style={composerFieldStyle}>
              <Text>Composer</Text>
            </View>
          </NewWorkspaceCanvas>
        </View>,
      );
    });

    for (const testId of ["new-workspace-project-field", "new-workspace-composer-field"]) {
      expect(
        dragRectanglesCover(testId),
        `${testId} should not sit inside a desktop window drag rectangle`,
      ).toBe(false);
    }
  });
});
