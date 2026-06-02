"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AccountTreeOutlinedIcon, ChecklistRtlRoundedIcon, TerminalRoundedIcon } from '@/utils/icons';
import { MappingDataPreviewIcon, MappingDataPreviewTable } from '@/features/sttm/mapping/data-preview';
import {
  Box,
  CircularProgress,
} from '@mui/material';





import { AiaResizeHandle } from '@/components/ui/aia-resize-handle';
import { useSidebarSlot } from '@/features/sttm/layout/sidebar-slot-context';
import { SttmSidebarCollapseFooter } from '@/features/sttm/layout/sttm-sidebar-collapse-footer';
import SourceTargetAttributeList from '@/features/sttm/mapping/source-target-attribute-list';
import SourceTargetAttributeMapping from '@/features/sttm/mapping/source-target-attribute-mapping';
import PreProcessModal from '@/features/sttm/mapping/pre-process-modal';
import { SttmLineageWorkspacePanel } from '@/features/sttm/lineage/sttm-lineage-workspace-panel';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import { useAppDispatch } from '@/store/hooks';
import { fetchAttributes } from '@/features/sttm/store/sttm-builder-slice';
import { collectSelectedSourceQualifiedNames } from '@/features/sttm/shared/sttm-selection-utils';
import {
  buildMappingInsertSql,
  buildSourceQueryPreviewSql,
} from '@/features/sttm/mapping/mapping-utils';
import { MappingSqlPreview } from '@/components/sql';
import { MappingProgressIndicator } from '@/features/sttm/shared/mapping-progress-indicator';
import { BuilderWorkspaceTabBar } from '@/features/sttm/shared/builder-workspace-tab-bar';

type MappingTab = 'mapping' | 'sql-preview' | 'data-preview' | 'data-lineage';

const MIN_SIDEBAR_WIDTH = 248;
const MAX_SIDEBAR_WIDTH = 420;
const COLLAPSED_SIDEBAR_WIDTH = 54;

function countFilterConditions(
  groups: Array<{ type?: string; children?: unknown[] }>,
): number {
  return groups.reduce((count, group) => {
    if (group.type === 'condition') {
      return count + 1;
    }
    const children = Array.isArray(group.children)
      ? (group.children as Array<{ type?: string; children?: unknown[] }>)
      : [];
    return count + countFilterConditions(children);
  }, 0);
}

export default function MappingPage() {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return (
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: '#fff',
          minHeight: 320,
        }}
      >
        <CircularProgress size={28} />
      </Box>
    );
  }

  return <MappingPageContent />;
}

function MappingPageContent() {
  const router = useRouter();
  const { setContent, collapsed, setCollapsed, width, setWidth } = useSidebarSlot();
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const dispatch = useAppDispatch();
  const [activeTab, setActiveTab] = useState<MappingTab>('mapping');
  const {
    mappings,
    targetAttributeGroup,
    initializeMappings,
    fullData,
    sources,
    targets,
    loadState,
    relationships,
    derivedSources,
    sourceFilterSql,
    sourceFilterGroups,
    sourceQuerySql,
    sourceGroupBySql,
    sourceOrderBySql,
  } = useSttmBuilderContext();

  const hasSelectedSources = useMemo(
    () => sources.some((table) => table.isSelected),
    [sources],
  );
  const hasSelectedDerivedSources = useMemo(
    () => derivedSources.some((source) => source.isSelected),
    [derivedSources],
  );
  const hasSelectedInputs = hasSelectedSources || hasSelectedDerivedSources;

  const hasSelectedTarget = useMemo(
    () => targets.some((table) => table.isSelected),
    [targets],
  );

  const hasTargetColumns = useMemo(
    () => (targetAttributeGroup?.columns?.filter((col) => col.name).length ?? 0) > 0,
    [targetAttributeGroup],
  );

  const totalCount = mappings.length;
  const mappedCount = mappings.filter((m) => m.status === 'MAPPED').length;
  const selectedInputCount = useMemo(
    () =>
      sources.filter((table) => table.isSelected).length +
      derivedSources.filter((source) => source.isSelected).length,
    [derivedSources, sources],
  );
  const filterCount = useMemo(
    () => countFilterConditions(sourceFilterGroups as Array<{ type?: string; children?: unknown[] }>),
    [sourceFilterGroups],
  );

  useEffect(() => {
    setContent(null);
    return () => setContent(null);
  }, [setContent]);

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

  useEffect(() => {
    if (!hasSelectedInputs || !hasSelectedTarget) {
      router.replace('/sttm/builder/new');
      return;
    }

    if (loadState.attributes === 'loading' || loadState.attributes === 'idle') {
      return;
    }

    if (!hasTargetColumns) {
      router.replace('/sttm/builder/new');
    }
  }, [
    hasSelectedInputs,
    hasSelectedTarget,
    hasTargetColumns,
    loadState.attributes,
    router,
  ]);

  const targetTableKey = targetAttributeGroup?.qualifiedName ?? '';
  const targetColumnsSignature = useMemo(
    () =>
      (targetAttributeGroup?.columns ?? [])
        .filter((col) => col.name)
        .map((col) => `${col.name}:${col.type ?? ''}`)
        .join('|'),
    [targetAttributeGroup],
  );

  useEffect(() => {
    if (!targetAttributeGroup || !targetColumnsSignature) {
      return;
    }

    const targetColumns = targetAttributeGroup.columns
      .filter((col) => col.name)
      .map((col) => col.name as string);
    const targetColumnSet = new Set(targetColumns);

    const matchesCurrentTarget =
      mappings.length === targetColumns.length &&
      mappings.every((m) => targetColumnSet.has(m.targetColumn));

    if (matchesCurrentTarget) {
      return;
    }

    const initialMappings = targetAttributeGroup.columns
      .filter((col) => col.name)
      .map((col, idx) => ({
        id: `${targetTableKey}-${idx}`,
        targetColumn: col.name as string,
        targetType: col.type || 'VARCHAR',
        sourceColumn: null,
        sourceType: null,
        expression: null,
        rule: 'Select...' as const,
        status: 'UNMAPPED' as const,
        nlRule: null,
        loadOrder: null,
        description: null,
        confidenceScore: null,
        confidenceReason: null,
        candidateSourceColumns: [],
        unmatchedReason: null,
        aiSuggestedRule: null,
        aiSuggestedRuleType: null,
      }));
    initializeMappings(initialMappings);
  }, [
    targetAttributeGroup,
    targetTableKey,
    targetColumnsSignature,
    mappings,
    initializeMappings,
  ]);

  const selectedSourceKey = useMemo(
    () =>
      collectSelectedSourceQualifiedNames(fullData?.sources ?? [])
        .sort()
        .join('|'),
    [fullData?.sources],
  );

  const selectedTargetKey =
    targets.find((table) => table.isSelected)?.qualifiedName ?? '';

  useEffect(() => {
    if (selectedSourceKey) {
      dispatch(
        fetchAttributes({
          qualifiedNames: selectedSourceKey.split('|'),
          side: 'source',
        }),
      );
    }
    if (selectedTargetKey) {
      dispatch(
        fetchAttributes({
          qualifiedNames: [selectedTargetKey],
          side: 'target',
        }),
      );
    }
  }, [dispatch, selectedSourceKey, selectedTargetKey]);

  const selectedTargetQualifiedName =
    targets.find((table) => table.isSelected)?.qualifiedName ??
    targetAttributeGroup?.qualifiedName ??
    null;

  const generatedSql = useMemo(
    () =>
      buildMappingInsertSql({
        mappings,
        targetQualifiedName: selectedTargetQualifiedName,
        sourceQuerySql,
        sourceFilterSql,
        sourceGroupBySql,
        sourceOrderBySql,
      }),
    [
      mappings,
      selectedTargetQualifiedName,
      sourceQuerySql,
      sourceFilterSql,
      sourceGroupBySql,
      sourceOrderBySql,
    ],
  );

  const sourceQueryPreviewSql = useMemo(
    () =>
      buildSourceQueryPreviewSql({
        sourceQuerySql,
        sourceFilterSql,
        sourceGroupBySql,
        sourceOrderBySql,
      }),
    [sourceFilterSql, sourceGroupBySql, sourceOrderBySql, sourceQuerySql],
  );

  useEffect(() => {
    const handleRunValidation = () => setActiveTab('sql-preview');
    window.addEventListener('sttm:run-validation', handleRunValidation);
    return () => window.removeEventListener('sttm:run-validation', handleRunValidation);
  }, []);

  const tabs: Array<{ key: MappingTab; label: string; icon: ReactNode; badge?: number }> = [
    { key: 'mapping', label: 'Mapping', icon: <ChecklistRtlRoundedIcon sx={{ fontSize: 17 }} /> },
    {
      key: 'sql-preview',
      label: 'SQL Preview',
      icon: <TerminalRoundedIcon sx={{ fontSize: 17 }} />,
      badge: mappedCount > 0 ? mappedCount : undefined,
    },
    { key: 'data-preview', label: 'Data Preview', icon: <MappingDataPreviewIcon /> },
    { key: 'data-lineage', label: 'Data Lineage', icon: <AccountTreeOutlinedIcon sx={{ fontSize: 17 }} /> },
  ];

  const progressTrailing = (
    <MappingProgressIndicator mappedCount={mappedCount} totalCount={totalCount} />
  );

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-white">
      <BuilderWorkspaceTabBar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        trailing={progressTrailing}
      />

      <Box
        sx={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        {activeTab === 'mapping' ? (
        <Box
          sx={{
            display: 'flex',
            width: collapsed ? COLLAPSED_SIDEBAR_WIDTH : width,
            minWidth: collapsed ? COLLAPSED_SIDEBAR_WIDTH : MIN_SIDEBAR_WIDTH,
            maxWidth: collapsed ? COLLAPSED_SIDEBAR_WIDTH : MAX_SIDEBAR_WIDTH,
            flexShrink: 0,
            borderRight: '1px solid #e5e7eb',
            overflow: 'hidden',
            bgcolor: 'var(--color-surface)',
            minHeight: 0,
            height: '100%',
          }}
        >
          {collapsed ? (
            <Box
              sx={{
                width: '100%',
                height: '100%',
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                <SourceTargetAttributeList embedded />
              </Box>
              <SttmSidebarCollapseFooter
                collapsed
                centered
                expandLabel="Expand source sidebar"
                onToggle={() => setCollapsed(false)}
              />
            </Box>
          ) : (
            <Box sx={{ display: 'flex', width: '100%', minWidth: 0, minHeight: 0, flex: 1 }}>
              <Box
                sx={{
                  minWidth: 0,
                  flex: 1,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                <SourceTargetAttributeList embedded />
              </Box>
              <AiaResizeHandle
                direction="horizontal"
                onMouseDown={beginResize}
                sx={{ alignSelf: 'stretch', height: '100%' }}
              />
            </Box>
          )}
        </Box>
        ) : null}

        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
        {activeTab === 'mapping' ? (
          <Box
            sx={{
              minWidth: 0,
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <SourceTargetAttributeMapping />
          </Box>
        ) : null}

        {activeTab === 'sql-preview' ? (
          <MappingSqlPreview
            targetLabel={selectedTargetQualifiedName?.split('.').pop() ?? null}
            mappedCount={mappedCount}
            tableCount={selectedInputCount}
            filterCount={filterCount}
            joinCount={relationships.length}
            sourceQuerySql={sourceQueryPreviewSql}
            generatedSql={generatedSql}
          />
        ) : null}

        {activeTab === 'data-preview' ? (
          <MappingDataPreviewTable
            mappings={mappings}
            targetLabel={
              targetAttributeGroup?.table ??
              selectedTargetQualifiedName?.split('.').pop() ??
              null
            }
            mappedCount={mappedCount}
          />
        ) : null}
        {activeTab === 'data-lineage' ? (
          <SttmLineageWorkspacePanel />
        ) : null}
        </Box>
      </Box>
      <PreProcessModal />
    </div>
  );
}
