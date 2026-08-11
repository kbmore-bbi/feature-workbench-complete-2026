'use client';

import { AiaBox, AiaTableCellPrimitive } from '@/components/ui';
import type { ReactNode } from 'react';
import type { SxProps, Theme } from '@mui/material/styles';

import {
  MAPPING_COLUMN_DIVIDER_WIDTH,
  MAPPING_COLUMN_RESIZE_HIT_WIDTH,
  mappingColumnDividerSx,
} from './mapping-column-divider';
import type { MappingColumnKey } from './use-mapping-column-widths';

type MappingResizableHeaderCellProps = {
  width: number;
  minWidth: number;
  children: ReactNode;
  sx?: SxProps<Theme>;
  resizeKey?: MappingColumnKey;
  onResizeStart?: (key: MappingColumnKey, event: React.MouseEvent<HTMLElement>) => void;
  padding?: 'none' | 'normal' | 'checkbox';
  'data-tour'?: string;
};

export function MappingColumnResizeHandle({
  resizeKey,
  onResizeStart,
}: {
  resizeKey: MappingColumnKey;
  onResizeStart: (key: MappingColumnKey, event: React.MouseEvent<HTMLElement>) => void;
}) {
  return (
    <AiaBox
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${resizeKey} column`}
      onMouseDown={(event) => onResizeStart(resizeKey, event)}
      sx={{
        position: 'absolute',
        top: 0,
        right: 0,
        width: MAPPING_COLUMN_RESIZE_HIT_WIDTH,
        height: '100%',
        transform: `translateX(${MAPPING_COLUMN_RESIZE_HIT_WIDTH / 2}px)`,
        cursor: 'col-resize',
        zIndex: 30,
        touchAction: 'none',
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
        '&::before': {
          content: '""',
          display: 'block',
          alignSelf: 'stretch',
          width: `${MAPPING_COLUMN_DIVIDER_WIDTH}px`,
          backgroundColor: '#e5e7eb',
          transition: 'background-color 120ms ease, width 120ms ease',
        },
        '&:hover::before, &:active::before': {
          width: '2px',
          backgroundColor: 'var(--color-primary-save, #0073a0)',
        },
      }}
    />
  );
}

export function MappingResizableHeaderCell({
  width,
  minWidth,
  children,
  sx,
  resizeKey,
  onResizeStart,
  padding,
  'data-tour': dataTour,
}: MappingResizableHeaderCellProps) {
  return (
    <AiaTableCellPrimitive
      padding={padding}
      data-tour={dataTour}
      sx={[
        sx,
        {
          width,
          minWidth,
          maxWidth: width,
          overflow: 'visible',
          boxSizing: 'border-box',
          ...mappingColumnDividerSx,
        },
      ]}
    >
      <AiaBox
        sx={{
          width: '100%',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          boxSizing: 'border-box',
        }}
      >
        {children}
      </AiaBox>
      {resizeKey && onResizeStart ? (
        <MappingColumnResizeHandle resizeKey={resizeKey} onResizeStart={onResizeStart} />
      ) : null}
    </AiaTableCellPrimitive>
  );
}
