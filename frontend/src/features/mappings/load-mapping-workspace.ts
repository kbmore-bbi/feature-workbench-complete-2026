import { loadMappingWorkspaceSnapshot } from '@/features/sttm/store/sttm-builder-slice';
import type { AppDispatch } from '@/store/store';
import { DEFAULT_MAPPING_WORKSPACE_SNAPSHOT } from './mapping-workspace-snapshot';

export function openMappingInBuilder(dispatch: AppDispatch) {
  dispatch(loadMappingWorkspaceSnapshot(DEFAULT_MAPPING_WORKSPACE_SNAPSHOT));
}
