import type { SxProps, Theme } from '@mui/material/styles';
import { GridViewRoundedIcon } from '@/utils/icons';

type MappingDataPreviewIconProps = {
  sx?: SxProps<Theme>;
};

export function MappingDataPreviewIcon({ sx }: MappingDataPreviewIconProps) {
  return (
    <GridViewRoundedIcon
      sx={{
        fontSize: 17,
        color: 'inherit',
        flexShrink: 0,
        ...sx,
      }}
    />
  );
}
