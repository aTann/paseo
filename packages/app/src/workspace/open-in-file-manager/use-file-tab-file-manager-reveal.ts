import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getIsElectron } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import { openDesktopTarget, useDesktopOpenTargets } from "@/workspace/desktop-open-targets";
import {
  buildFileManagerRevealLaunch,
  type FileTabFileManagerReveal,
} from "@/workspace/open-in-file-manager/launch";

export function useFileTabFileManagerReveal(input: {
  serverId: string;
  workspaceId: string;
}): FileTabFileManagerReveal | null {
  const { t } = useTranslation();
  const toast = useToast();
  const isElectron = getIsElectron();
  const isLocalDaemon = useIsLocalDaemon(input.serverId);
  const workspaceDirectory = useWorkspaceDirectory(input.serverId, input.workspaceId);
  const workspaceRoot = workspaceDirectory?.trim() ?? "";
  const canReveal = isElectron && isLocalDaemon && workspaceRoot.length > 0;
  const { targets } = useDesktopOpenTargets({ isLocalExecution: canReveal });
  const fileManagerTarget = targets.find((target) => target.kind === "file-manager");

  const onSelect = useCallback(
    (tabPath: string) => {
      if (!fileManagerTarget || workspaceRoot.length === 0) {
        return;
      }
      const launch = buildFileManagerRevealLaunch({
        editorId: fileManagerTarget.id,
        workspaceRoot,
        tabPath,
      });
      if (!launch) {
        toast.error(t("workspace.fileExplorer.errors.revealFailed"));
        return;
      }
      void openDesktopTarget(launch).catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message.trim() : "";
        toast.error(message || t("workspace.fileExplorer.errors.revealFailed"));
      });
    },
    [fileManagerTarget, t, toast, workspaceRoot],
  );

  return useMemo(() => {
    if (!fileManagerTarget || workspaceRoot.length === 0) {
      return null;
    }
    return {
      label: t("workspace.fileActions.revealIn", { target: fileManagerTarget.label }),
      onSelect,
    };
  }, [fileManagerTarget, onSelect, t, workspaceRoot]);
}
