'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SidebarHost } from '@/features/sttm/layout/sidebar-host';
import { SidebarSlotProvider, useSidebarSlot } from '@/features/sttm/layout/sidebar-slot-context';
import { usePathname, useRouter } from 'next/navigation';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import {
  getSelectedSourceTables,
  getSelectedTargetTable,
} from '@/features/sttm/shared/sttm-selection-utils';
import { dbService } from '@/services/dbService';
import { KeyboardDoubleArrowRightRoundedIcon } from '@/utils/icons';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  IconButton,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';

import { AiaResizeHandle } from '@/components/ui/aia-resize-handle';

type SemanticPrepState = {
  open: boolean;
  loading: boolean;
  progress: number;
  title: string;
  detail: string;
  error?: string | null;
};

const initialSemanticPrepState: SemanticPrepState = {
  open: false,
  loading: false,
  progress: 0,
  title: 'Preparing semantic view',
  detail: 'Checking the current source-to-target selection.',
  error: null,
};

const MIN_SIDEBAR_WIDTH = 248;
const MAX_SIDEBAR_WIDTH = 420;
const COLLAPSED_SIDEBAR_WIDTH = 54;

function BuilderLayoutShell({ children }: { children: ReactNode }) {
  const [semanticPrepState, setSemanticPrepState] = useState<SemanticPrepState>(initialSemanticPrepState);
  const router = useRouter();
  const pathname = usePathname();
  const { content, collapsed, setCollapsed, width, setWidth } = useSidebarSlot();
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const proceedToMappingRef = useRef<() => void>(() => {});
  const {
    fullData,
    derivedSources,
    relationships,
    applySemanticRefresh,
  } = useSttmBuilderContext();

  const selectedSourceTables = useMemo(
    () => getSelectedSourceTables(fullData?.sources ?? []),
    [fullData?.sources],
  );

  const selectedTargetTable = useMemo(
    () => getSelectedTargetTable(fullData?.targets ?? []),
    [fullData?.targets],
  );

  useEffect(() => {
    const handlePointerMove = (event: MouseEvent) => {
      const state = resizeStateRef.current;
      if (!state) {
        return;
      }
      const nextWidth = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, state.startWidth + event.clientX - state.startX),
      );
      setWidth(nextWidth);
    };

    const handlePointerUp = () => {
      resizeStateRef.current = null;
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
    };
  }, [setWidth]);

  const beginResize = (event: React.MouseEvent<HTMLDivElement>) => {
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: width,
    };
  };

  const makeTableRef = (qualifiedName: string) => {
    const [database, schema, table] = qualifiedName.split('.', 3);
    return { database, schema, table };
  };

  const isWorkspacePage = pathname.includes('/mapping') || pathname.includes('/summary');
  const showSidebarHost = !isWorkspacePage && content !== null;

  const canProceedToMapping = useMemo(
    () =>
      (selectedSourceTables.length > 0 || derivedSources.some((source) => source.isSelected)) &&
      Boolean(selectedTargetTable),
    [derivedSources, selectedSourceTables, selectedTargetTable],
  );

  const selectedDerivedSourceIds = useMemo(
    () => derivedSources.filter((source) => source.isSelected).map((source) => source.id),
    [derivedSources],
  );

  const proceedToMapping = async () => {
    if (!canProceedToMapping) {
      return;
    }

    const selectedTarget = selectedTargetTable;
    if (!selectedTarget) {
      return;
    }

    setSemanticPrepState({
      open: true,
      loading: true,
      progress: 12,
      title: 'Preparing semantic view',
      detail: 'Checking the selected sources, joins, and target table.',
      error: null,
    });

    try {
      setSemanticPrepState((current) => ({
        ...current,
        progress: 46,
        detail: 'Checking freshness and required semantic level for the current source-to-target context.',
      }));

      const refresh = await dbService.refreshSemanticContext({
        selected_source_tables: selectedSourceTables.map((table) => makeTableRef(table.qualifiedName)),
        selected_derived_sources: selectedDerivedSourceIds,
        target_table: makeTableRef(selectedTarget.qualifiedName),
        relationships: relationships
          .filter((join) => join.leftTableId && join.rightTableId && join.conditions?.length)
          .map((join) => ({
            left_table: makeTableRef(join.leftTableId as string),
            right_table: makeTableRef(join.rightTableId as string),
            constraint_name: join.constraintName ?? null,
            join_type: join.joinType ?? 'INNER',
            source: join.source ?? 'USER_DEFINED',
            locked: join.locked ?? false,
            conditions: (join.conditions ?? []).map((condition) => ({
              left_column: condition.leftColumn,
              right_column: condition.rightColumn,
              operator: condition.operator ?? '=',
            })),
          })),
        requested_level: 'L3_MAPPING_ENRICHED',
        force: false,
      });

      applySemanticRefresh(refresh);

      const completionDetail = refresh.cache_hit
        ? (
            refresh.semantic_view_name
              ? `Semantic view ${refresh.semantic_view_name} is already fresh. Opening mapping.`
              : 'Semantic bundle is already fresh. Opening mapping.'
          )
        : refresh.promoted
          ? (
              refresh.semantic_view_name
                ? `Semantic view ${refresh.semantic_view_name} is ready. Opening mapping.`
                : 'Semantic context has been promoted. Opening mapping.'
            )
          : refresh.status === 'partial'
            ? 'Semantic context is partially ready with the freshest available metadata. Opening mapping.'
            : 'Semantic context has been refreshed. Opening mapping.';

      setSemanticPrepState({
        open: true,
        loading: false,
        progress: 100,
        title: refresh.cache_hit ? 'Semantic view already ready' : 'Semantic view ready',
        detail: completionDetail,
        error: null,
      });

      window.setTimeout(() => {
        setSemanticPrepState(initialSemanticPrepState);
        router.push('/sttm/builder/new/mapping');
      }, 350);
    } catch (error) {
      setSemanticPrepState({
        open: true,
        loading: false,
        progress: 100,
        title: 'Semantic preparation failed',
        detail: 'The mapping page was not opened because the semantic view could not be prepared.',
        error: error instanceof Error ? error.message : 'Unable to prepare the semantic view.',
      });
    }
  };

  useEffect(() => {
    proceedToMappingRef.current = () => {
      void proceedToMapping();
    };
  });

  useEffect(() => {
    const handleProceedToMapping = () => {
      if (pathname.includes('/mapping') || pathname.includes('/summary')) {
        return;
      }
      proceedToMappingRef.current();
    };

    window.addEventListener('sttm:proceed-to-mapping', handleProceedToMapping);
    return () => {
      window.removeEventListener('sttm:proceed-to-mapping', handleProceedToMapping);
    };
  }, [pathname]);

  return (
    <>
      <div className="flex h-[calc(100vh-60px)] flex-col bg-gray-50">
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {showSidebarHost ? (
            <aside
              className="hidden shrink-0 border-r border-gray-200 bg-white md:flex"
              style={{ width: collapsed ? COLLAPSED_SIDEBAR_WIDTH : width }}
            >
              {collapsed ? (
                <Box
                  sx={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'center',
                    py: 1.25,
                  }}
                >
                  <TooltipButton
                    title="Expand source sidebar"
                    onClick={() => setCollapsed(false)}
                    icon={<KeyboardDoubleArrowRightRoundedIcon sx={{ fontSize: 18 }} />}
                  />
                </Box>
              ) : (
                <Box sx={{ display: 'flex', width: '100%', minWidth: 0, height: '100%', minHeight: 0 }}>
                  <Box sx={{ minWidth: 0, flex: 1, height: '100%', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <SidebarHost />
                  </Box>
                  <AiaResizeHandle
                    direction="horizontal"
                    onMouseDown={beginResize}
                    sx={{ alignSelf: 'stretch', height: '100%' }}
                  />
                </Box>
              )}
            </aside>
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <main
              className={
                isWorkspacePage
                  ? 'flex min-h-0 flex-1 overflow-hidden bg-white'
                  : 'flex min-h-0 flex-1 overflow-auto bg-white'
              }
            >
              {children}
            </main>
          </div>
        </div>
      </div>
      <Dialog
        open={semanticPrepState.open}
        onClose={() => {
          if (!semanticPrepState.loading) {
            setSemanticPrepState(initialSemanticPrepState);
          }
        }}
        maxWidth="xs"
        fullWidth
      >
        <Box sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              {semanticPrepState.loading ? <CircularProgress size={22} /> : null}
              <Box>
                <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
                  {semanticPrepState.title}
                </Typography>
                <Typography sx={{ fontSize: 13, color: '#475569', mt: 0.5 }}>
                  {semanticPrepState.detail}
                </Typography>
              </Box>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={semanticPrepState.progress}
              sx={{
                height: 8,
                borderRadius: 999,
                backgroundColor: '#e2e8f0',
                '& .MuiLinearProgress-bar': {
                  borderRadius: 999,
                  backgroundColor: '#2563eb',
                },
              }}
            />
            {semanticPrepState.error ? (
              <Box
                sx={{
                  borderRadius: 2,
                  border: '1px solid #fecaca',
                  backgroundColor: '#fef2f2',
                  px: 1.5,
                  py: 1.25,
                }}
              >
                <Typography sx={{ fontSize: 13, color: '#b91c1c' }}>
                  {semanticPrepState.error}
                </Typography>
              </Box>
            ) : null}
            {!semanticPrepState.loading ? (
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                <Button
                  onClick={() => setSemanticPrepState(initialSemanticPrepState)}
                  sx={{ textTransform: 'none' }}
                >
                  Close
                </Button>
              </Stack>
            ) : null}
          </Stack>
        </Box>
      </Dialog>
    </>
  );
}

function TooltipButton({
  title,
  onClick,
  icon,
}: {
  title: string;
  onClick: () => void;
  icon: ReactNode;
}) {
  return (
    <IconButton
      size="small"
      onClick={onClick}
      aria-label={title}
      sx={{
        color: '#475569',
        border: '1px solid #dbe2ea',
        backgroundColor: '#fff',
        '&:hover': {
          backgroundColor: '#f8fafc',
        },
      }}
    >
      {icon}
    </IconButton>
  );
}

export default function BuilderLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <SidebarSlotProvider>
      <BuilderLayoutShell>{children}</BuilderLayoutShell>
    </SidebarSlotProvider>
  );
}
