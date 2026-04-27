import { TableCell, Typography } from '@mui/material';

export const FocusColumnCell = ({
  name,
  type,
}: {
  name: string;
  type: string;
}) => (
  <TableCell>
    <Typography variant="body2" sx={{ fontWeight: 600 }}>
      {name}
    </Typography>
    <Typography variant="caption" color="text.secondary">
      {type}
    </Typography>
  </TableCell>
);
