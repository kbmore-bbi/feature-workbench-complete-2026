"use client";

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useSidebarSlot } from '@/features/sttm/layout/sidebar-slot-context';
import SourceTargetAttributeList from '@/features/sttm/mapping/source-target-attribute-list';
import SourceTargetAttributeMapping from '@/features/sttm/mapping/source-target-attribute-mapping';
import PreProcessModal from '@/features/sttm/mapping/pre-process-modal';
import MappingQualityPanel from '@/features/sttm/mapping/mapping-quality';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import { useAppDispatch } from '@/store/hooks';
import { fetchAttributes } from '@/features/sttm/store/sttm-builder-slice';

export default function MappingPage() {
  const router = useRouter();
  const { setContent } = useSidebarSlot();
  const dispatch = useAppDispatch();
  const {
    mappings,
    targetAttributeGroup,
    initializeMappings,
    sources,
    targets,
    loadState,
  } = useSttmBuilderContext();

  const hasSelectedSources = useMemo(
    () => sources.some((table) => table.isSelected),
    [sources],
  );

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

  useEffect(() => {
    setContent(<SourceTargetAttributeList />);
  }, [setContent]);

  useEffect(() => {
    if (!hasSelectedSources || !hasSelectedTarget) {
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
    hasSelectedSources,
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
      sources
        .filter((table) => table.isSelected)
        .map((table) => table.qualifiedName)
        .sort()
        .join('|'),
    [sources],
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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-hidden border-r border-[#e5e7eb]">
          <SourceTargetAttributeMapping />
        </div>
        <div className="w-[300px] shrink-0 overflow-hidden p-3">
          <MappingQualityPanel
            mappedCount={mappedCount}
            totalCount={totalCount}
            onRunValidation={() => console.log('run validation')}
          />
        </div>
      </div>
      <PreProcessModal />
    </div>
  );
}
