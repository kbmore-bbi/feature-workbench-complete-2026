"use client";
import { AiaBox, AiaTooltip } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import { KeyboardArrowDownRoundedIcon, KeyboardArrowRightRoundedIcon } from '@/utils/icons';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  AIA_RESIZE_HANDLE_THICKNESS,
  AiaResizeHandle,
} from "@/components/ui/aia-resize-handle";
import { SIDEBAR_NAV_TOKENS } from "@/config/sidebar-nav-tokens";
import { sttmSidebarIconSlotSx } from "@/features/sttm/layout/sttm-sidebar-icon-slot";

export type ResizableSidebarSection = {
  id: string;
  title: string;
  content: ReactNode;
  icon?: ReactNode;
  tourTarget?: string;
};

type ResizableSidebarSectionsProps = {
  sections: ResizableSidebarSection[];
  defaultExpanded?: Record<string, boolean>;
  minBodyHeight?: number;
  /** When the whole sidebar rail is icon-only; section headers still show icon + label when false. */
  sidebarCollapsed?: boolean;
};

const SECTION_HEADER_HEIGHT = SIDEBAR_NAV_TOKENS.itemHeight;
const RESIZE_HANDLE_HEIGHT = AIA_RESIZE_HANDLE_THICKNESS;
const MIN_BODY_HEIGHT_DEFAULT = 72;

export function ResizableSidebarSections({
  sections,
  defaultExpanded,
  minBodyHeight = MIN_BODY_HEIGHT_DEFAULT,
  sidebarCollapsed = false,
}: ResizableSidebarSectionsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const section of sections) {
      initial[section.id] = defaultExpanded?.[section.id] ?? true;
    }
    return initial;
  });
  const [bodyHeights, setBodyHeights] = useState<number[]>(() =>
    sections.map(() => minBodyHeight),
  );
  const dragStateRef = useRef<{ index: number; startY: number; startTop: number; startBottom: number } | null>(
    null,
  );
  const expandedSnapshotRef = useRef("");

  const getExpandedSnapshot = useCallback(
    () => sections.map((section) => `${section.id}:${expanded[section.id] ? 1 : 0}`).join("|"),
    [expanded, sections],
  );

  const getAvailableBodyHeight = useCallback(
    (containerHeight: number, expandedState: Record<string, boolean>) => {
      const expandedCount = sections.filter((section) => expandedState[section.id]).length;
      const chromeHeight =
        sections.length * SECTION_HEADER_HEIGHT +
        Math.max(0, sections.length - 1) * RESIZE_HANDLE_HEIGHT;

      return Math.max(expandedCount * minBodyHeight, containerHeight - chromeHeight);
    },
    [minBodyHeight, sections],
  );

  const distributeHeights = useCallback(
    (availableBodyHeight: number, expandedState: Record<string, boolean>) => {
      const expandedIndexes = sections
        .map((section, index) => ({ section, index }))
        .filter(({ section }) => expandedState[section.id])
        .map(({ index }) => index);

      if (expandedIndexes.length === 0) {
        return sections.map(() => 0);
      }

      const perSection = Math.max(
        minBodyHeight,
        Math.floor(availableBodyHeight / expandedIndexes.length),
      );

      return sections.map((section, index) =>
        expandedState[section.id] ? perSection : 0,
      );
    },
    [minBodyHeight, sections],
  );

  const measureAndSyncHeights = useCallback(
    (force = false) => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const snapshot = getExpandedSnapshot();
      const expandedChanged = snapshot !== expandedSnapshotRef.current;
      expandedSnapshotRef.current = snapshot;

      const availableBodyHeight = getAvailableBodyHeight(container.clientHeight, expanded);

      setBodyHeights((current) => {
        const totalCurrent = current.reduce(
          (sum, height, index) => sum + (expanded[sections[index].id] ? height : 0),
          0,
        );

        if (
          force ||
          expandedChanged ||
          totalCurrent <= 0 ||
          Math.abs(totalCurrent - availableBodyHeight) > 8
        ) {
          return distributeHeights(availableBodyHeight, expanded);
        }

        return current;
      });
    },
    [distributeHeights, expanded, getAvailableBodyHeight, getExpandedSnapshot, sections],
  );

  useLayoutEffect(() => {
    measureAndSyncHeights();
  }, [measureAndSyncHeights]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const observer = new ResizeObserver(() => {
      measureAndSyncHeights();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [measureAndSyncHeights]);

  const toggleSection = (sectionId: string) => {
    setExpanded((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  const beginResize = (index: number, event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragStateRef.current = {
      index,
      startY: event.clientY,
      startTop: bodyHeights[index] ?? minBodyHeight,
      startBottom: bodyHeights[index + 1] ?? minBodyHeight,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const state = dragStateRef.current;
      if (!state) {
        return;
      }

      const delta = moveEvent.clientY - state.startY;
      const maxTop = state.startTop + state.startBottom - minBodyHeight;
      const nextTop = Math.min(maxTop, Math.max(minBodyHeight, state.startTop + delta));
      const nextBottom = state.startTop + state.startBottom - nextTop;

      setBodyHeights((current) => {
        const next = [...current];
        next[state.index] = nextTop;
        next[state.index + 1] = nextBottom;
        return next;
      });
    };

    const handleMouseUp = () => {
      dragStateRef.current = null;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  return (
    <AiaBox
      ref={containerRef}
      sx={{
        flex: 1,
        minHeight: 0,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {sections.map((section, index) => {
        const isExpanded = expanded[section.id];
        const bodyHeight = bodyHeights[index] ?? minBodyHeight;

        return (
          <AiaBox
            key={section.id}
            sx={{
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              flexShrink: 0,
            }}
          >
            <AiaBox
              onClick={() => toggleSection(section.id)}
              data-tour={section.tourTarget}
              sx={{
                height: "var(--aia-sidebar-nav-item-height)",
                minHeight: "var(--aia-sidebar-nav-item-height)",
                px: "var(--aia-sidebar-nav-padding-x)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer",
                flexShrink: 0,
                backgroundColor: "#fafafa",
                borderBottom: "1px solid #eef2f7",
                userSelect: "none",
                overflow: "visible",
              }}
            >
              <AiaBox
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--aia-sidebar-nav-icon-gap)",
                  minWidth: 0,
                  flex: 1,
                  justifyContent: sidebarCollapsed ? "center" : "flex-start",
                  overflow: "visible",
                }}
              >
                {section.icon ? (
                  sidebarCollapsed ? (
                    <AiaTooltip title={section.title} placement="right" arrow>
                      <AiaBox sx={sttmSidebarIconSlotSx}>
                        {section.icon}
                      </AiaBox>
                    </AiaTooltip>
                  ) : (
                    <>
                      <AiaBox
                        sx={{
                          ...sttmSidebarIconSlotSx,
                          color: "var(--aia-sidebar-nav-icon-color)",
                          "& .MuiSvgIcon-root": {
                            color: "inherit",
                          },
                        }}
                      >
                        {section.icon}
                      </AiaBox>
                      <AiaText
                        sx={{
                          fontSize: "var(--aia-sidebar-nav-font-size)",
                          fontWeight: "var(--aia-sidebar-nav-font-weight)",
                          lineHeight: "var(--aia-sidebar-nav-line-height)",
                          color: "var(--aia-sidebar-nav-text-color)",
                          textTransform: "capitalize",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {section.title}
                      </AiaText>
                    </>
                  )
                ) : (
                  <AiaText
                    sx={{
                      fontSize: "var(--aia-sidebar-nav-font-size)",
                      fontWeight: "var(--aia-sidebar-nav-font-weight)",
                      lineHeight: "var(--aia-sidebar-nav-line-height)",
                      color: "var(--aia-sidebar-nav-text-color)",
                      textTransform: "capitalize",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {section.title}
                  </AiaText>
                )}
              </AiaBox>
              {isExpanded ? (
                <KeyboardArrowDownRoundedIcon
                  sx={{
                    fontSize: "var(--aia-sidebar-nav-icon-size)",
                    color: "var(--aia-sidebar-nav-icon-color)",
                    flexShrink: 0,
                  }}
                />
              ) : (
                <KeyboardArrowRightRoundedIcon
                  sx={{
                    fontSize: "var(--aia-sidebar-nav-icon-size)",
                    color: "var(--aia-sidebar-nav-icon-color)",
                    flexShrink: 0,
                  }}
                />
              )}
            </AiaBox>

            {isExpanded ? (
              <AiaBox
                className="sttm-scroll-pane"
                sx={{
                  height: bodyHeight,
                  minHeight: minBodyHeight,
                  flexShrink: 0,
                  overflowY: "auto",
                  overflowX: "hidden",
                  px: 0.5,
                  pb: 0.5,
                }}
              >
                {section.content}
              </AiaBox>
            ) : null}

            {index < sections.length - 1 ? (
              <AiaResizeHandle
                direction="vertical"
                active={isExpanded && expanded[sections[index + 1]?.id]}
                onMouseDown={(event) => {
                  if (!isExpanded || !expanded[sections[index + 1]?.id]) {
                    return;
                  }
                  beginResize(index, event);
                }}
              />
            ) : null}
          </AiaBox>
        );
      })}
    </AiaBox>
  );
}
