import { loadMappingWorkspaceSnapshot, openSttmFromBackend } from '@/features/sttm/store/sttm-builder-slice';
import type { AppDispatch } from '@/store/store';
import { DEFAULT_MAPPING_WORKSPACE_SNAPSHOT } from './mapping-workspace-snapshot';

/**
 * Open a mapping in the STTM builder.
 *
 * When `options.sttmId` and `options.projectId` are provided, the saved STTM is
 * fetched from the backend and loaded into the builder (real resume from Snowflake).
 * Navigation to the correct builder page must happen in the caller by watching
 * `state.sttmBuilder.openSttmStatus` / `openSttmTargetPage`.
 *
 * Without options, loads the default demo/empty workspace snapshot (new mapping flow).
 */
export function openMappingInBuilder(
  dispatch: AppDispatch,
  options?: { sttmId: string; projectId: string },
) {
  if (options?.sttmId && options?.projectId) {
    dispatch(openSttmFromBackend({ sttmId: options.sttmId, projectId: options.projectId }));
  } else {
    dispatch(loadMappingWorkspaceSnapshot(DEFAULT_MAPPING_WORKSPACE_SNAPSHOT));
  }
}
