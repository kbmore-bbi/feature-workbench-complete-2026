'use client';

import { useState } from 'react';
import Card from '@mui/material/Card';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import CheckIcon from '@mui/icons-material/Check';
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';
import { FocusCheckbox } from '@/components/ui/focus-checkbox';
import { FocusRadio } from '@/components/ui/focus-radio';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';
import { FocusChip } from '@/components/ui/focus-chip';

function tagChipPalette(tag: string, isSelected: boolean) {
  if (isSelected) {
    return { bg: 'rgba(255,255,255,0.14)', color: '#ffffff' };
  }
  const t = String(tag).toLowerCase();
  if (t.includes('staging')) return { bg: '#f3e8ff', color: '#7c3aed' };
  if (t.includes('sales')) return { bg: '#dbeafe', color: '#1d4ed8' };
  if (t.includes('core')) return { bg: '#f3f4f6', color: '#4b5563' };
  if (t.includes('transaction')) return { bg: '#ffedd5', color: '#c2410c' };
  if (t.includes('master')) return { bg: '#e0e7ff', color: '#4338ca' };
  if (t.includes('billing') || t.includes('finance')) return { bg: '#ecfdf5', color: '#047857' };
  return { bg: '#f1f5f9', color: '#475569' };
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
  return (
    <>
      <Card
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
          borderColor: isSelected ? '#0b1220' : '#e5e7eb',
          backgroundColor: isSelected ? '#1e293b' : '#ffffff',
          color: isSelected ? '#ffffff' : '#111827',
          transition: '120ms ease',
          boxShadow: isSelected ? '0 6px 18px rgba(15,23,42,0.18)' : 'none',
          '&:hover': {
            borderColor: isSelected ? '#0f172a' : '#cbd5e1',
            backgroundColor: isSelected ? '#1e293b' : '#f8fafc',
            boxShadow: isSelected ? '0 6px 18px rgba(15,23,42,0.18)' : '0 4px 12px rgba(15,23,42,0.06)',
          }
        }}
      >
        {/* The table icon */}
        {type === 'source' ? (
          <FocusCheckbox
            checked={isSelected}
            checkHandler={() => selectHandler(item.tableId)}
            uncheckedColor={isSelected ? '#ffffff' : '#111827'}
            checkedColor={isSelected ? '#ffffff' : '#111827'}
          />
        ) : (
          <FocusRadio
            checked={isSelected}
            checkHandler={() => selectHandler(item.tableId)}
          />
        )}

        <TableChartOutlinedIcon
          sx={{ color: isSelected ? '#cbd5e1' : '#9ca3af', fontSize: 20, flexShrink: 0 }}
        />

        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 700,
                lineHeight: 1.2,
                color: isSelected ? '#ffffff' : '#111827',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {item.tableName}
            </Typography>
            <FocusChip
              label={tag}
              size="small"
              rounded={false}
              customBackgroundColor={chipColors.bg}
              customColor={chipColors.color}
              sx={{
                height: 20,
                fontSize: 10,
                fontWeight: 700,
                border: "none",
                "& .MuiChip-label": { px: 0.75, py: 0 },
              }}
            />
            {isDrivingTable && (
              <FocusChip
                label="DRIVING"
                size="small"
                rounded={false}
                customBackgroundColor={isSelected ? "rgba(250,204,21,0.2)" : "#fef08a"}
                customColor={isSelected ? "#fde047" : "#854d0e"}
                sx={{
                  height: 20,
                  fontSize: 10,
                  fontWeight: 700,
                  border: "none",
                  "& .MuiChip-label": { px: 0.75, py: 0 },
                }}
              />
            )}
          </Box>
          <Typography
            variant="caption"
            sx={{ color: isSelected ? 'rgba(226,232,240,0.9)' : 'text.secondary' }}
          >
            {metaLeft?.schemaName || "—"} · {metaLeft?.dbName || "—"}
          </Typography>
        </Box>

        <Box sx={{ textAlign: 'right', minWidth: 72 }}>
          <Typography
            variant="caption"
            sx={{ display: 'block', fontWeight: 800, color: isSelected ? '#ffffff' : '#111827' }}
          >
            {item.rows ?? '—'}
          </Typography>
          <Typography
            variant="caption"
            sx={{ display: 'block', color: isSelected ? 'rgba(226,232,240,0.9)' : 'text.secondary' }}
          >
            {item.columns ?? '—'} cols
          </Typography>
        </Box>

        {type === 'source' && (
          <Box sx={{ ml: 0.5 }} onClick={(e) => e.stopPropagation()}>
            <IconButton
              size="small"
              onClick={handleMenuClick}
              sx={{ color: isSelected ? 'rgba(255,255,255,0.7)' : 'text.secondary' }}
            >
              <MoreVertIcon fontSize="small" />
            </IconButton>
            <Menu
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
              <MenuItem
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
              </MenuItem>
            </Menu>
          </Box>
        )}
      </Card>

    </>

  );
}
