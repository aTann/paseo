import type { ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

const WINDOW_CONTENT_DATASET = { "window-content": "" };

/**
 * The new-workspace body under the header. It stays out of the window drag region:
 * a full-size drag overlay here swallows dropdowns and inputs, and a double-click
 * maximizes the desktop window.
 */
export function NewWorkspaceCanvas({ children }: { children: ReactNode }) {
  return (
    <View style={styles.content} dataSet={WINDOW_CONTENT_DATASET}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  content: {
    position: "relative" as const,
    flex: 1,
  },
}));
