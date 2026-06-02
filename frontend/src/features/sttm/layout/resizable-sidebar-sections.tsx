"use client";
import { KeyboardArrowDownRoundedIcon, KeyboardArrowRightRoundedIcon } from '@/utils/icons';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";


import { Box, Tooltip, Typography } from "@mui/material";
import {
  AIA_RESIZE_HANDLE_THICKNESS,
  AiaResizeHandle,
} from "@/components/ui/aia-resize-handle";

export type ResizableSidebarSection = {
  id: string;
  title: string;
  content: ReactNode;
  icon?: ReactNode;
};

type ResizableSidebarSectionsProps = {
  sections: ResizableSidebarSection[];
  defaultExpanded?: Record<string, boolean>;
  minBodyHeight?: number;
};

const SECTION_HEADER_HEIGHT = 32;
const RESIZE_HANDLE_HEIGHT = AIA_RESIZE_HANDLE_THICKNESS;
const MIN_BODY_HEIGHT_DEFAULT = 72;

export function ResizableSidebarSections({
  sections,
  defaultExpanded,
  minBodyHeight = MIN_BODY_HEIGHT_DEFAULT,
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
    <Box
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
          <Box
            key={section.id}
            sx={{
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              flexShrink: 0,
            }}
          >
            <Box
              onClick={() => toggleSection(section.id)}
              sx={{
                height: SECTION_HEADER_HEIGHT,
                px: 1.5,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer",
                flexShrink: 0,
                backgroundColor: "#fafafa",
                borderBottom: "1px solid #eef2f7",
                userSelect: "none",
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0.75,
                  minWidth: 0,
                  flex: 1,
                  justifyContent: isExpanded ? "flex-start" : "center",
                }}
              >
                {section.icon ? (
                  isExpanded ? (
                    <>
                      {section.icon}
                      <Typography
                        sx={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: "var(--color-muted)",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {section.title}
                      </Typography>
                    </>
                  ) : (
                    <Tooltip title={section.title} placement="right">
                      <Box
                        sx={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {section.icon}
                      </Box>
                    </Tooltip>
                  )
                ) : (
                  <Typography
                    sx={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--color-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {section.title}
                  </Typography>
                )}
              </Box>
              {isExpanded ? (
                <KeyboardArrowDownRoundedIcon sx={{ fontSize: 16, color: "var(--color-muted)" }} />
              ) : (
                <KeyboardArrowRightRoundedIcon sx={{ fontSize: 16, color: "var(--color-muted)" }} />
              )}
            </Box>

            {isExpanded ? (
              <Box
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
              </Box>
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
          </Box>
        );
      })}
    </Box>
  );
}
