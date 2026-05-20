import { FocusChipCell } from '@/components/ui/focus-table';
import { formatSqlType, typeChipSx } from '../mapping-utils';

type MappingTypePreviewCellProps = {
  dataType?: string;
  width?: number | string;
  minWidth?: number | string;
};

export const MappingTypePreviewCell = ({
  dataType,
  width = 140,
  minWidth,
}: MappingTypePreviewCellProps) => {
  if (!dataType) {
    return (
      <FocusChipCell
        label=""
        width={width}
        minWidth={minWidth}
      />
    );
  }
  return (
    <FocusChipCell
      label={formatSqlType(dataType)}
      chipSx={typeChipSx(dataType)}
      rounded={false}
      width={width}
      minWidth={minWidth}
    />
  );
};
