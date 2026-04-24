'use client';

import Card from '@mui/material/Card';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';
import { FocusCheckbox } from '@/components/ui/focus-checkbox';
import { FocusRadio } from '@/components/ui/focus-radio';
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';


export default function SourceTargetItem({ type = 'source', item, selectHandler }: any) {
  const { sourceInfo, targetInfo }: any = useSttmBuilderContext();
  return (
    <>
      <Card
        variant="outlined"
        onClick={() => selectHandler(item.tableId)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          p: 1,
          mb: 0.75,
          gap: 0, // Reduced from 2 to 1 for a tighter look
          cursor: 'pointer',
          borderRadius: 2, // Matches the rounded corners in your image
          backgroundColor: item.isSelected && '#e0e0e0'
        }}
      >
        {/* The table icon */}
        {type === 'source' ? (
          <FocusCheckbox checked={item.isSelected} checkHandler={() => selectHandler(item.tableId)} />
        ) : (
          <FocusRadio checked={item.isSelected} checkHandler={() => selectHandler(item.tableId)} />
        )}

        <TableChartOutlinedIcon sx={{ color: 'text.secondary', fontSize: 20, ml: 0.5 }} />

        <Box sx={{ flexGrow: 1, ml: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
            {item.tableName}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {type == 'source' ? sourceInfo.dbName : targetInfo.dbName} &bull; {type == 'source' ? sourceInfo.schemaName : targetInfo.schemaName}
          </Typography>
        </Box>
      </Card>

    </>

  );
}
