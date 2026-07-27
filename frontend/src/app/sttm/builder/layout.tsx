'use client';
import { AiaBox, AiaButton, AiaCircularProgress, AiaDialog, AiaIconButton, AiaLinearProgress, AiaStack } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SidebarHost } from '@/features/sttm/layout/sidebar-host';
import { SidebarSlotProvider, useSidebarSlot } from '@/features/sttm/layout/sidebar-slot-context';
import { usePathname, useRouter } from 'next/navigation';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import { resolveBuilderSelectionState } from '@/features/sttm/shared/sttm-selection-utils';
import { AiaResizeHandle } from '@/components/ui/aia-resize-handle';
import { SttmSidebarCollapseFooter } from '@/features/sttm/layout/sttm-sidebar-collapse-footer';

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
const COLLAPSED_SIDEBAR_WIDTH = 70;

function BuilderLayoutShell({ children }: { children: ReactNode }) {
  const [semanticPrepState, setSemanticPrepState] = useState<SemanticPrepState>(initialSemanticPrepState);
  const router = useRouter();
  const pathname = usePathname();
  const { content, collapsed, setCollapsed, width, setWidth } = useSidebarSlot();
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const proceedToMappingRef = useRef<() => void>(() => {});
  const {
    fullData,
    sources,
    targets,
    derivedSources,
    semanticBundleId,
    semanticViewName,
    activeProjectId,
    activeSttmId,
    activeProjectName,
    activeSttmName,
  } = useSttmBuilderContext();

  const { resolvedSourceTables: selectedSourceTables, selectedTargetTable, canProceedToMapping } = useMemo(
    () =>
      resolveBuilderSelectionState({
        sourceDatabases: fullData?.sources ?? [],
        targetDatabases: fullData?.targets ?? [],
        sources,
        targets,
        derivedSources,
      }),
    [derivedSources, fullData?.sources, fullData?.targets, sources, targets],
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

  const isWorkspacePage = pathname.includes('/mapping') || pathname.includes('/summary');
  const showSidebarHost = !isWorkspacePage && content !== null;

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
      title: 'Opening mapping workspace',
      detail: 'Opening with the current source, join, target, and semantic context.',
      error: null,
    });

    setSemanticPrepState((current) => ({
      ...current,
      progress: 52,
      detail: semanticBundleId || semanticViewName
        ? 'Reusing the current semantic context and opening mapping now.'
        : 'Opening mapping now. No semantic refresh will run from the mapping page.',
    }));

    window.setTimeout(() => {
      setSemanticPrepState({
        open: true,
        loading: false,
        progress: 100,
        title: semanticBundleId || semanticViewName ? 'Opening mapping with current context' : 'Opening mapping',
        detail: semanticBundleId || semanticViewName
          ? 'Mapping is opening with the current semantic context.'
          : 'Mapping is opening now. Resolve semantic context on the selection page if agents need it.',
        error: null,
      });
      window.setTimeout(() => {
        setSemanticPrepState(initialSemanticPrepState);
        router.push('/sttm/builder/new/mapping');
      }, 250);
    }, 150);
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
      {/* Context indicator - shows when mapping has no project association */}
      {!activeProjectId && !activeSttmId && (
        <AiaBox
          sx={{
            px: 2,
            py: 0.75,
            backgroundColor: '#fef3c7',
            borderBottom: '1px solid #fcd34d',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
          }}
        >
          <AiaText sx={{ fontSize: '0.8rem', color: '#92400e', fontWeight: 600 }}>
            Unsaved mapping
          </AiaText>
          <AiaText sx={{ fontSize: '0.76rem', color: '#a16207' }}>
            This mapping is not associated with a project. Go to Projects to create a mapping within a project context.
          </AiaText>
        </AiaBox>
      )}
      {activeProjectId && activeSttmId && (
        <AiaBox
          sx={{
            px: 2,
            py: 0.5,
            backgroundColor: '#f0fdf4',
            borderBottom: '1px solid #86efac',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
          }}
        >
          <AiaText sx={{ fontSize: '0.76rem', color: '#166534', fontWeight: 600 }}>
            Project: {activeProjectName || `${activeProjectId.slice(0, 8)}...`}
          </AiaText>
          <AiaText sx={{ fontSize: '0.72rem', color: '#15803d' }}>
            Mapping: {activeSttmName || `${activeSttmId.slice(0, 8)}...`}
          </AiaText>
        </AiaBox>
      )}
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-gray-50">
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {showSidebarHost ? (
            <aside
              className="hidden shrink-0 border-r border-gray-200 bg-white md:flex"
              style={{ width: collapsed ? COLLAPSED_SIDEBAR_WIDTH : width }}
            >
              {collapsed ? (
                <AiaBox
                  sx={{
                    width: '100%',
                    height: '100%',
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <AiaBox sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                    <SidebarHost />
                  </AiaBox>
                  <SttmSidebarCollapseFooter
                    collapsed
                    centered
                    expandLabel="Expand source sidebar"
                    onToggle={() => setCollapsed(false)}
                  />
                </AiaBox>
              ) : (
                <AiaBox sx={{ display: 'flex', width: '100%', minWidth: 0, height: '100%', minHeight: 0 }}>
                  <AiaBox sx={{ minWidth: 0, flex: 1, height: '100%', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <AiaBox sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                      <SidebarHost />
                    </AiaBox>
                  </AiaBox>
                  <AiaResizeHandle
                    direction="horizontal"
                    onMouseDown={beginResize}
                    sx={{ alignSelf: 'stretch', height: '100%' }}
                  />
                </AiaBox>
              )}
            </aside>
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <main
              className={
                isWorkspacePage
                  ? 'flex min-h-0 flex-1 overflow-hidden bg-white'
                  : 'flex min-h-0 flex-1 flex-col overflow-hidden bg-white'
              }
            >
              {children}
            </main>
          </div>
        </div>
      </div>
      <AiaDialog
        open={semanticPrepState.open}
        onClose={() => {
          if (!semanticPrepState.loading) {
            setSemanticPrepState(initialSemanticPrepState);
          }
        }}
        maxWidth="xs"
        fullWidth
      >
        <AiaBox sx={{ p: 3 }}>
          <AiaStack spacing={2}>
            <AiaStack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              {semanticPrepState.loading ? <AiaCircularProgress size={22} /> : null}
              <AiaBox>
                <AiaText sx={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
                  {semanticPrepState.title}
                </AiaText>
                <AiaText sx={{ fontSize: 13, color: '#475569', mt: 0.5 }}>
                  {semanticPrepState.detail}
                </AiaText>
              </AiaBox>
            </AiaStack>
            <AiaLinearProgress
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
              <AiaBox
                sx={{
                  borderRadius: 2,
                  border: '1px solid #fecaca',
                  backgroundColor: '#fef2f2',
                  px: 1.5,
                  py: 1.25,
                }}
              >
                <AiaText sx={{ fontSize: 13, color: '#b91c1c' }}>
                  {semanticPrepState.error}
                </AiaText>
              </AiaBox>
            ) : null}
            {!semanticPrepState.loading ? (
              <AiaStack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                <AiaButton
                  onClick={() => setSemanticPrepState(initialSemanticPrepState)}
                  sx={{ textTransform: 'none' }}
                >
                  Close
                </AiaButton>
              </AiaStack>
            ) : null}
          </AiaStack>
        </AiaBox>
      </AiaDialog>
    </>
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
