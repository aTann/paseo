import { describe, expect, it } from "vitest";
import { buildFileManagerRevealLaunch } from "./launch";

describe("buildFileManagerRevealLaunch", () => {
  it("joins a workspace-relative tab path onto the workspace root", () => {
    expect(
      buildFileManagerRevealLaunch({
        editorId: "finder",
        workspaceRoot: "/Users/me/repo",
        tabPath: "src/app.ts",
      }),
    ).toEqual({
      editorId: "finder",
      workspacePath: "/Users/me/repo",
      filePath: "/Users/me/repo/src/app.ts",
    });
  });

  it("keeps an absolute path that already lives inside the workspace", () => {
    expect(
      buildFileManagerRevealLaunch({
        editorId: "explorer",
        workspaceRoot: "C:\\Users\\me\\repo",
        tabPath: "C:\\Users\\me\\repo\\src\\app.ts",
      }),
    ).toEqual({
      editorId: "explorer",
      workspacePath: "C:\\Users\\me\\repo",
      filePath: "C:/Users/me/repo/src/app.ts",
    });
  });

  it("reveals an absolute file outside the workspace", () => {
    expect(
      buildFileManagerRevealLaunch({
        editorId: "file-manager",
        workspaceRoot: "/Users/me/repo",
        tabPath: "/etc/hosts",
      }),
    ).toEqual({
      editorId: "file-manager",
      workspacePath: "/Users/me/repo",
      filePath: "/etc/hosts",
    });
  });

  it("returns null when the tab path cannot be resolved", () => {
    expect(
      buildFileManagerRevealLaunch({
        editorId: "finder",
        workspaceRoot: "/Users/me/repo",
        tabPath: "~/notes.txt",
      }),
    ).toBeNull();
    expect(
      buildFileManagerRevealLaunch({
        editorId: "finder",
        workspaceRoot: "/Users/me/repo",
        tabPath: "../outside.ts",
      }),
    ).toBeNull();
    expect(
      buildFileManagerRevealLaunch({
        editorId: " ",
        workspaceRoot: "/Users/me/repo",
        tabPath: "src/app.ts",
      }),
    ).toBeNull();
    expect(
      buildFileManagerRevealLaunch({
        editorId: "finder",
        workspaceRoot: " ",
        tabPath: "src/app.ts",
      }),
    ).toBeNull();
  });
});
