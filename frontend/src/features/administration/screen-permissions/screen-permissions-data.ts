import type {
  AdminPersona,
  ScreenPermissionSection,
} from '@/data/mock/administration';

export type {
  AdminPersona,
  ScreenPermissionItem,
  ScreenPermissionLevel,
  ScreenPermissionSection,
} from '@/data/mock/administration';
export { MOCK_SCREEN_PERMISSION_SECTIONS as SCREEN_PERMISSION_SECTIONS } from '@/data/mock/administration';

export const ADMIN_PERSONAS: AdminPersona[] = ['Admin', 'Publisher', 'Editor', 'Viewer'];

export const PERSONA_DOT_COLORS: Record<AdminPersona, string> = {
  Admin: '#7C3AED',
  Publisher: '#2563EB',
  Editor: '#D97706',
  Viewer: '#64748B',
};

export function countPermissionsForPersona(
  sections: ScreenPermissionSection[],
  persona: AdminPersona,
): { edit: number; view: number; hidden: number; total: number } {
  const counts = { edit: 0, view: 0, hidden: 0, total: 0 };

  sections.forEach((section) => {
    section.screens.forEach((screen) => {
      counts.total += 1;
      counts[screen.permissions[persona]] += 1;
    });
  });

  return counts;
}
