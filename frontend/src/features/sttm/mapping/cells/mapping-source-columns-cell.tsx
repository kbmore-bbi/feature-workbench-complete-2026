import { Box, TableCell, Tooltip, Typography } from '@mui/material';
import { focusTableCellSx } from '@/components/ui/focus-table';

type MappingSourceColumnsCellProps = {
  values: string[];
  placeholder?: string;
  width?: number | string;
  minWidth?: number | string;
};

export const MappingSourceColumnsCell = ({
  values,
  placeholder = 'No source selected',
  width,
  minWidth,
}: MappingSourceColumnsCellProps) => {
  const joined = values.join(', ');
  const hasValues = values.length > 0;

  const content = (
    <Typography
      sx={{
        fontSize: '0.8rem',
        color: hasValues ? '#111827' : '#9ca3af',
        display: '-webkit-box',
        WebkitBoxOrient: 'vertical',
        WebkitLineClamp: 2,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        lineHeight: 1.4,
        wordBreak: 'break-word',
      }}
    >
      {hasValues ? joined : placeholder}
    </Typography>
  );

  return (
    <TableCell sx={focusTableCellSx({ width, minWidth })}>
      {hasValues ? (
        <Tooltip
          title={joined}
          placement="top"
          arrow
          enterDelay={300}
          slotProps={{
            tooltip: {
              sx: {
                fontSize: '0.72rem',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                maxWidth: 360,
              },
            },
          }}
        >
          <Box>{content}</Box>
        </Tooltip>
      ) : (
        content
      )}
    </TableCell>
  );
};
