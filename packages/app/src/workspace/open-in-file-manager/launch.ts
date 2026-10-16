import type { OpenDesktopTargetInput } from "@/workspace/desktop-open-targets";
import { resolveWorkspaceFilePaths } from "@/workspace/file-open";

export interface FileTabFileManagerReveal {
  label: string;
  onSelect: (path: string) => void;
}

interface BuildFileManagerRevealLaunchInput {
  editorId: string;
  workspaceRoot: string;
  tabPath: string;
}

export function buildFileManagerRevealLaunch(
  input: BuildFileManagerRevealLaunchInput,
): OpenDesktopTargetInput | null {
  const editorId = input.editorId.trim();
  const workspaceRoot = input.workspaceRoot.trim();
  if (!editorId || !workspaceRoot) {
    return null;
  }

  const resolved = resolveWorkspaceFilePaths({
    path: input.tabPath,
    workspaceRoot,
  });
  if (!resolved) {
    return null;
  }

  return {
    editorId,
    workspacePath: workspaceRoot,
    filePath: resolved.absolutePath,
  };
}
