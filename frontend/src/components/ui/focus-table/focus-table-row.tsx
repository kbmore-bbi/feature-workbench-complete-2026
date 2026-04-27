import { TableRow } from '@mui/material';

const FocusTableRow = ({
  children,
}: {
  children: React.ReactNode;
}) => (
  <TableRow hover>
    {children}
  </TableRow>
);

export { FocusTableRow };