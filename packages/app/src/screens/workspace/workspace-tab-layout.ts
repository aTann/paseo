export type WorkspaceTabCloseButtonPolicy = "all";

export interface WorkspaceTabLayoutMetrics {
  rowHorizontalInset: number;
  actionsReservedWidth: number;
  overflowControlWidth: number;
  rowPaddingHorizontal: number;
  tabGap: number;
  minTabWidth: number;
  maxTabWidth: number;
  tabIconWidth: number;
  tabContentGap: number;
  tabHorizontalPadding: number;
  closeButtonWidth: number;
}

export interface WorkspaceTabLayoutInput {
  viewportWidth: number;
  tabLabelWidths: number[];
  metrics: WorkspaceTabLayoutMetrics;
}

export interface WorkspaceTabLayoutItem {
  width: number;
  showLabel: boolean;
}

export interface WorkspaceTabLayoutResult {
  items: WorkspaceTabLayoutItem[];
  closeButtonPolicy: WorkspaceTabCloseButtonPolicy;
  requiresHorizontalScrollFallback: boolean;
}

export interface WorkspaceTabRange {
  start: number;
  end: number;
}

export function retainWorkspaceTabMeasuredWidth(
  currentWidth: number,
  measuredWidth: number,
): number {
  if (measuredWidth <= 0 || Math.abs(currentWidth - measuredWidth) <= 1) {
    return currentWidth;
  }
  return measuredWidth;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

export function computeWorkspaceTabRange(input: {
  index: number;
  tabWidths: number[];
  tabGap: number;
  rowPaddingHorizontal: number;
  slotStartInset: number;
}): WorkspaceTabRange {
  const width = input.tabWidths[input.index] ?? 0;
  let start = input.rowPaddingHorizontal + input.slotStartInset;
  for (let index = 0; index < input.index; index += 1) {
    start += (input.tabWidths[index] ?? 0) + input.tabGap;
  }
  return { start, end: start + width };
}

export function computeWorkspaceTabScrollOffset(input: {
  tabRange: WorkspaceTabRange;
  viewportWidth: number;
  currentOffset: number;
  edgePadding: number;
}): number {
  if (input.viewportWidth <= 0) {
    return input.currentOffset;
  }

  const tabWidth = input.tabRange.end - input.tabRange.start;
  if (tabWidth >= input.viewportWidth) {
    return Math.max(0, input.tabRange.start);
  }

  const paddedStart = input.tabRange.start - input.edgePadding;
  if (paddedStart < input.currentOffset) {
    return Math.max(0, paddedStart);
  }

  const paddedEnd = input.tabRange.end + input.edgePadding;
  const viewportEnd = input.currentOffset + input.viewportWidth;
  if (paddedEnd > viewportEnd) {
    return Math.max(0, paddedEnd - input.viewportWidth);
  }

  return input.currentOffset;
}

function computeWorkspaceTabLayoutPass(
  input: WorkspaceTabLayoutInput,
  actionsReservedWidth: number,
): WorkspaceTabLayoutResult {
  const tabCount = input.tabLabelWidths.length;
  if (tabCount === 0) {
    return {
      items: [],
      closeButtonPolicy: "all",
      requiresHorizontalScrollFallback: false,
    };
  }

  const availableWidth = Math.max(
    0,
    input.viewportWidth - input.metrics.rowHorizontalInset * 2 - actionsReservedWidth,
  );
  const rowOverhead =
    input.metrics.rowPaddingHorizontal * 2 + Math.max(tabCount - 1, 0) * input.metrics.tabGap;
  const availableTabsWidth = Math.max(0, availableWidth - rowOverhead);
  const tabChromeWidth =
    input.metrics.tabIconWidth +
    input.metrics.tabContentGap +
    input.metrics.tabHorizontalPadding * 2 +
    input.metrics.closeButtonWidth;
  const naturalWidths = input.tabLabelWidths.map((labelWidth) =>
    clamp(tabChromeWidth + labelWidth, input.metrics.minTabWidth, input.metrics.maxTabWidth),
  );
  const naturalTotalWidth = naturalWidths.reduce((total, width) => total + width, 0);
  const minimumTotalWidth = input.metrics.minTabWidth * tabCount;
  const requiresHorizontalScrollFallback = availableTabsWidth < minimumTotalWidth;

  let resolvedWidths = naturalWidths;
  if (requiresHorizontalScrollFallback) {
    resolvedWidths = Array.from({ length: tabCount }, () => input.metrics.minTabWidth);
  } else if (naturalTotalWidth > availableTabsWidth) {
    const widthToRemove = naturalTotalWidth - availableTabsWidth;
    const shrinkCapacity = naturalTotalWidth - minimumTotalWidth;
    const shrinkRatio = widthToRemove / shrinkCapacity;
    resolvedWidths = naturalWidths.map(
      (width) => width - (width - input.metrics.minTabWidth) * shrinkRatio,
    );
  }

  const roundedWidths = resolvedWidths.map((width) =>
    Math.round(clamp(width, input.metrics.minTabWidth, input.metrics.maxTabWidth)),
  );

  return {
    items: roundedWidths.map((width) => ({
      width,
      showLabel: width > tabChromeWidth,
    })),
    closeButtonPolicy: "all",
    requiresHorizontalScrollFallback,
  };
}

export function computeWorkspaceTabLayout(
  input: WorkspaceTabLayoutInput,
): WorkspaceTabLayoutResult {
  const layout = computeWorkspaceTabLayoutPass(input, input.metrics.actionsReservedWidth);
  if (!layout.requiresHorizontalScrollFallback || input.metrics.overflowControlWidth <= 0) {
    return layout;
  }

  return computeWorkspaceTabLayoutPass(
    input,
    input.metrics.actionsReservedWidth + input.metrics.overflowControlWidth,
  );
}
