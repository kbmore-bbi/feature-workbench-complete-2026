import type { SxProps, Theme } from '@mui/material/styles';
import {
  SchemaRoundedIcon,
  StorageRoundedIcon,
  TableChartOutlinedIcon,
  ViewColumnOutlinedIcon,
} from '@/utils/icons';

export type HierarchyLevel = 'database' | 'schema' | 'table' | 'column';

const BASE_SX: SxProps<Theme> = {
  flexShrink: 0,
  color: 'var(--color-muted)',
};

export const HIERARCHY_ICON_SX: Record<HierarchyLevel, SxProps<Theme>> = {
  database: { ...BASE_SX, fontSize: 15 },
  schema: { ...BASE_SX, fontSize: 14 },
  table: { ...BASE_SX, fontSize: 14 },
  column: { ...BASE_SX, fontSize: 13, mt: 0.55 },
};

export function HierarchyIcon({
  level,
  sx,
}: {
  level: HierarchyLevel;
  sx?: SxProps<Theme>;
}) {
  const mergedSx = [HIERARCHY_ICON_SX[level], ...(sx ? (Array.isArray(sx) ? sx : [sx]) : [])];

  switch (level) {
    case 'database':
      return <StorageRoundedIcon sx={mergedSx} />;
    case 'schema':
      return <SchemaRoundedIcon sx={mergedSx} />;
    case 'table':
      return <TableChartOutlinedIcon sx={mergedSx} />;
    case 'column':
      return <ViewColumnOutlinedIcon sx={mergedSx} />;
    default:
      return null;
  }
}
