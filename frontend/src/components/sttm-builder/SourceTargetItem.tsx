'use client';

import Card from '@mui/material/Card';
import Checkbox from '@mui/material/Checkbox';
import Radio from '@mui/material/Radio';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';
// Checkbox, Typography, Stack, Box, Chip

import { FocusCheckbox } from '../shared/FocusCheckbox';
import { FocusRadio } from '../shared/FocusRadio';
import { useDataContext } from '../../contexts/DataContext';


export default function SourceTargetItem({ type = 'source', item, selectHandler }: any) {
  const { sourceInfo, targetInfo }: any = useDataContext();
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
          borderRadius: 2 // Matches the rounded corners in your image
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
