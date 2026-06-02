import { AiaChipCell } from '@/components/ui/aia-table';
import type { SxProps, Theme } from '@mui/material/styles';
import { formatSqlType, typeChipSx } from '../mapping-utils';

type MappingTypePreviewCellProps = {
  dataType?: string;
  width?: number | string;
  minWidth?: number | string;
  sx?: SxProps<Theme>;
};

export const MappingTypePreviewCell = ({
  dataType,
  width = 140,
  minWidth,
  sx,
}: MappingTypePreviewCellProps) => {
  if (!dataType) {
    return (
      <AiaChipCell
        label=""
        width={width}
        minWidth={minWidth}
        sx={sx}
      />
    );
  }
  return (
    <AiaChipCell
      label={formatSqlType(dataType)}
      chipSx={typeChipSx(dataType)}
      rounded={false}
      width={width}
      minWidth={minWidth}
      sx={sx}
    />
  );
};
