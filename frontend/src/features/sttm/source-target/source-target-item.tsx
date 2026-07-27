'use client';
import { AiaText } from '@/components/ui/aia-text';
import { useState } from 'react';
import { AiaCard } from '@/components/ui';
import { AiaBox } from '@/components/ui';

import { AiaIconButton } from '@/components/ui';
import { AiaMenu } from '@/components/ui';
import { AiaMenuItem } from '@/components/ui';
import { CheckIcon, MoreVertIcon, TableChartOutlinedIcon } from '@/utils/icons';



import { AiaCheckbox } from '@/components/ui/aia-checkbox';
import { AiaRadio } from '@/components/ui/aia-radio';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import { AiaChip } from '@/components/ui/aia-chip';
import { BODY_SX, SECONDARY_TEXT_SX, TYPOGRAPHY_TOKENS } from '@/config/typography-tokens';

function tagChipPalette(tag: string, isSelected: boolean) {
  if (isSelected) {
    return {
      bg: 'rgba(255,255,255,0.14)',
      color: '#ffffff',
      border: 'rgba(255,255,255,0.28)',
    };
  }
  const t = String(tag).toLowerCase();
  if (t.includes('staging')) return { bg: '#f3e8ff', color: '#7c3aed', border: '#e9d5ff' };
  if (t.includes('sales')) return { bg: '#dbeafe', color: '#1d4ed8', border: '#bfdbfe' };
  if (t.includes('core')) return { bg: '#f3f4f6', color: '#4b5563', border: '#e5e7eb' };
  if (t.includes('transaction')) return { bg: '#ffedd5', color: '#c2410c', border: '#fed7aa' };
  if (t.includes('master')) return { bg: '#e0e7ff', color: '#4338ca', border: '#c7d2fe' };
  if (t.includes('billing') || t.includes('finance')) {
    return { bg: '#ecfdf5', color: '#047857', border: '#bbf7d0' };
  }
  return { bg: '#f1f5f9', color: '#475569', border: '#e2e8f0' };
}

export default function SourceTargetItem({ type = 'source', item, selectHandler }: any) {
  const { sourceInfo, targetInfo, drivingTableId, setDrivingTable }: any = useSttmBuilderContext();
  const isSelected = !!item.isSelected;
  const tag = item.tag ?? (type === 'source' ? 'Source' : 'Target');
  const chipColors = tagChipPalette(tag, isSelected);

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleMenuClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = (event: React.MouseEvent) => {
    event.stopPropagation();
    setAnchorEl(null);
  };

  const handleMakeDrivingTable = (event: React.MouseEvent) => {
    event.stopPropagation();
    setDrivingTable(item.tableId);
    setAnchorEl(null);
  };

  const isDrivingTable = type === 'source' && drivingTableId === item.tableId;

  const metaLeft = type === 'source' ? sourceInfo : targetInfo;
  const itemQualifiedName = String(item.qualifiedName ?? item.tableId ?? "").trim();
  const qualifiedNameParts = itemQualifiedName.split(".").filter(Boolean);
  const itemDatabaseName = qualifiedNameParts.length >= 3 ? qualifiedNameParts[0] : "";
  const itemSchemaName = qualifiedNameParts.length >= 3 ? qualifiedNameParts[1] : "";
  // Saved mappings restore selected tables before the schema browser is opened.
  // In that state sourceInfo/targetInfo is intentionally empty, while the table's
  // own qualifiedName remains authoritative. Per-item metadata also matters for
  // mappings whose selected relations span more than one database or schema.
  const databaseName = itemDatabaseName || metaLeft?.dbName || "—";
  const schemaName = itemSchemaName || metaLeft?.schemaName || "—";
  return (
    <>
      <AiaCard
        variant="outlined"
        onClick={() => selectHandler(item.tableId)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          px: 1.25,
          py: 0.9,
          mb: 0.9,
          gap: 1,
          cursor: 'pointer',
          borderRadius: '10px',
          borderColor: isSelected ? 'var(--aia-primary-bg-color)' : '#e5e7eb',
          backgroundColor: isSelected ? 'var(--aia-primary-bg-color)' : '#ffffff',
          color: isSelected ? 'var(--aia-primary-bg-text-color)' : '#111827',
          transition: '120ms ease',
          boxShadow: 'none',
          '&:hover': {
            borderColor: isSelected ? 'var(--aia-primary-bg-hover-color)' : '#cbd5e1',
            backgroundColor: isSelected ? 'var(--aia-primary-bg-hover-color)' : '#f8fafc',
            boxShadow: isSelected ? 'none' : '0 4px 12px rgba(15,23,42,0.06)',
          }
        }}
      >
        {/* The table icon */}
        {type === 'source' ? (
          <AiaCheckbox
            checked={isSelected}
            checkHandler={() => selectHandler(item.tableId)}
            uncheckedColor={isSelected ? 'var(--aia-primary-bg-text-color)' : '#111827'}
            checkedColor={isSelected ? 'var(--aia-primary-bg-text-color)' : '#111827'}
          />
        ) : (
          <AiaRadio
            checked={isSelected}
            checkHandler={() => selectHandler(item.tableId)}
          />
        )}

        <TableChartOutlinedIcon
          sx={{
            color: isSelected ? 'var(--aia-primary-bg-text-color)' : '#9ca3af',
            opacity: isSelected ? 0.85 : 1,
            fontSize: 20,
            flexShrink: 0,
          }}
        />

        <AiaBox sx={{ flexGrow: 1, minWidth: 0 }}>
          <AiaBox sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, minWidth: 0 }}>
            <AiaText
              sx={{
                ...BODY_SX,
                color: isSelected ? 'var(--aia-primary-bg-text-color)' : TYPOGRAPHY_TOKENS.body.color,
                whiteSpace: 'normal',
                overflowWrap: 'anywhere',
                lineHeight: 1.35,
              }}
            >
              {item.tableName}
            </AiaText>

            {isDrivingTable && (
              <AiaChip
                label="Driving"
                size="small"
                color="warning"
                customBackgroundColor={isSelected ? "rgba(250,204,21,0.2)" : "#fef08a"}
                customColor={isSelected ? "#fde047" : "#854d0e"}
                customBorderColor={isSelected ? "rgba(250,204,21,0.45)" : "#fde047"}
                sx={{
                  height: 22,
                  fontSize: 10,
                  fontWeight: 700,
                  "& .MuiChip-label": { px: 0.75, py: 0 },
                }}
              />
            )}
          </AiaBox>
          <AiaText
            sx={{
              ...SECONDARY_TEXT_SX,
              color: isSelected
                ? 'color-mix(in srgb, var(--aia-primary-bg-text-color) 88%, transparent)'
                : TYPOGRAPHY_TOKENS.secondaryText.color,
              whiteSpace: 'normal',
              overflowWrap: 'anywhere',
            }}
          >
            {schemaName} · {databaseName}
          </AiaText>
        </AiaBox>

        <AiaBox sx={{ textAlign: 'right', minWidth: 72 }}>
          <AiaText
            sx={{
              ...SECONDARY_TEXT_SX,
              display: 'block',
              color: isSelected
                ? 'var(--aia-primary-bg-text-color)'
                : TYPOGRAPHY_TOKENS.secondaryText.color,
            }}
          >
            {item.rows ?? '—'}
          </AiaText>
          <AiaText
            sx={{
              ...SECONDARY_TEXT_SX,
              display: 'block',
              color: isSelected
                ? 'color-mix(in srgb, var(--aia-primary-bg-text-color) 88%, transparent)'
                : TYPOGRAPHY_TOKENS.secondaryText.color,
            }}
          >
            {item.columns ?? '—'} cols
          </AiaText>
        </AiaBox>

        {type === 'source' && (
          <AiaBox sx={{ ml: 0.5 }} onClick={(e) => e.stopPropagation()}>
            <AiaIconButton
              size="small"
              onClick={handleMenuClick}
              sx={{
                color: isSelected
                  ? 'color-mix(in srgb, var(--aia-primary-bg-text-color) 70%, transparent)'
                  : 'text.secondary',
              }}
            >
              <MoreVertIcon fontSize="small" />
            </AiaIconButton>
            <AiaMenu
              anchorEl={anchorEl}
              open={open}
              onClose={handleMenuClose}
              onClick={(e) => e.stopPropagation()}
              slotProps={{
                paper: {
                  sx: {
                    minWidth: 160,
                    boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
                    borderRadius: '8px',
                  }
                }
              }}
              transformOrigin={{ horizontal: 'right', vertical: 'top' }}
              anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
            >
              <AiaMenuItem
                onClick={handleMakeDrivingTable}
                disabled={!isSelected}
                sx={{
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  opacity: !isSelected ? 0.5 : 1,
                  filter: !isSelected ? 'blur(0.5px)' : 'none',
                  textTransform: !isSelected ? 'uppercase' : 'none',
                }}
              >
                Mark as driving table
                {isDrivingTable && <CheckIcon fontSize="small" sx={{ ml: 2, color: 'primary.main' }} />}
              </AiaMenuItem>
            </AiaMenu>
          </AiaBox>
        )}
      </AiaCard>

    </>

  );
}
