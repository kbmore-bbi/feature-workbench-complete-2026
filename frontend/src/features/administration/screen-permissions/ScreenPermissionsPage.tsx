'use client';

import { AiaBox, AiaButton, AiaChip, AiaPaper, AiaStack } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import { FiberManualRecordRoundedIcon } from '@/utils/icons';
import { useMemo, useState } from 'react';
import AdminPageHeader from '../shared/admin-page-header';
import {
  adminContentScrollSx,
  adminMutedTextSx,
  adminPageShellSx,
} from '../shared/administration-ui-styles';
import type { AdminPersona, ScreenPermissionLevel, ScreenPermissionSection } from '@/data/mock/administration';
import {
  ADMIN_PERSONAS,
  PERSONA_DOT_COLORS,
  SCREEN_PERMISSION_SECTIONS,
  countPermissionsForPersona,
} from './screen-permissions-data';
import {
  ScreenPermissionRow,
  ScreenPermissionSectionAccordion,
  ScreenPermissionsLegend,
} from './screen-permissions-ui';

export default function ScreenPermissionsPage() {
  const [selectedPersona, setSelectedPersona] = useState<AdminPersona>('Publisher');
  const [sections, setSections] = useState<ScreenPermissionSection[]>(SCREEN_PERMISSION_SECTIONS);

  const summary = useMemo(
    () => countPermissionsForPersona(sections, selectedPersona),
    [sections, selectedPersona],
  );

  const updateScreenPermission = (
    sectionId: string,
    screenId: string,
    level: ScreenPermissionLevel,
  ) => {
    setSections((current) =>
      current.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              screens: section.screens.map((screen) =>
                screen.id === screenId
                  ? {
                      ...screen,
                      permissions: {
                        ...screen.permissions,
                        [selectedPersona]: level,
                      },
                    }
                  : screen,
              ),
            }
          : section,
      ),
    );
  };

  const updateSectionPermissions = (sectionId: string, level: ScreenPermissionLevel) => {
    setSections((current) =>
      current.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              screens: section.screens.map((screen) => ({
                ...screen,
                permissions: {
                  ...screen.permissions,
                  [selectedPersona]: level,
                },
              })),
            }
          : section,
      ),
    );
  };

  return (
    <AiaBox sx={adminPageShellSx}>
      <AiaBox sx={adminContentScrollSx}>
        <AiaBox className="px-5 py-4">
          <AdminPageHeader
            title="Screen Editing Permissions"
            subtitle="Control which screens each persona can edit, view (read-only), or access at all."
            actions={
              <AiaButton variant="contained" color="primary" size="medium">
                Save Changes
              </AiaButton>
            }
          />

          <AiaBox className="mt-4 flex flex-wrap gap-2">
            {ADMIN_PERSONAS.map((persona) => {
              const isActive = selectedPersona === persona;
              return (
                <AiaBox
                  key={persona}
                  component="button"
                  type="button"
                  onClick={() => setSelectedPersona(persona)}
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1.5,
                    py: 0.75,
                    borderRadius: '8px',
                    border: `1px solid ${isActive ? PERSONA_DOT_COLORS[persona] : '#E2E8F0'}`,
                    bgcolor: isActive ? `${PERSONA_DOT_COLORS[persona]}10` : '#FFFFFF',
                    color: isActive ? PERSONA_DOT_COLORS[persona] : '#64748B',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 600,
                  }}
                >
                  <FiberManualRecordRoundedIcon
                    sx={{ fontSize: 10, color: PERSONA_DOT_COLORS[persona] }}
                  />
                  {persona}
                  {persona === 'Admin' ? (
                    <AiaChip
                      label="FULL"
                      customBackgroundColor="#F5F3FF"
                      customBorderColor="#DDD6FE"
                      customColor="#6D28D9"
                      sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: 10 } }}
                    />
                  ) : null}
                </AiaBox>
              );
            })}
          </AiaBox>

          <AiaPaper
            elevation={0}
            sx={{
              mt: 2,
              px: 2,
              py: 1.25,
              borderRadius: '12px',
              border: '1px solid #E8ECF4',
              bgcolor: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
              flexWrap: 'wrap',
            }}
          >
            <AiaBox className="flex flex-wrap items-center gap-3">
              <AiaText sx={{ ...adminMutedTextSx, color: '#16A34A', fontWeight: 700 }}>
                {summary.edit} Edit
              </AiaText>
              <AiaText sx={{ ...adminMutedTextSx, color: '#2563EB', fontWeight: 700 }}>
                {summary.view} View
              </AiaText>
              <AiaText sx={{ ...adminMutedTextSx, color: '#DC2626', fontWeight: 700 }}>
                {summary.hidden} Hidden
              </AiaText>
            </AiaBox>
            <AiaText sx={adminMutedTextSx}>
              {summary.total} screens total · Persona: {selectedPersona}
            </AiaText>
          </AiaPaper>

          <AiaStack spacing={1.5} sx={{ mt: 2 }}>
            {sections.map((section) => (
              <ScreenPermissionSectionAccordion
                key={section.id}
                title={section.title}
                screenCount={section.screens.length}
                onBulkChange={(level) => updateSectionPermissions(section.id, level)}
              >
                {section.screens.map((screen) => (
                  <ScreenPermissionRow
                    key={screen.id}
                    title={screen.title}
                    description={screen.description}
                    value={screen.permissions[selectedPersona]}
                    onChange={(level) => updateScreenPermission(section.id, screen.id, level)}
                  />
                ))}
              </ScreenPermissionSectionAccordion>
            ))}
          </AiaStack>

          <ScreenPermissionsLegend />
        </AiaBox>
      </AiaBox>
    </AiaBox>
  );
}
