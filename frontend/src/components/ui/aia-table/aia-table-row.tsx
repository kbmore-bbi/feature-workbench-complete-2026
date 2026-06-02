import { TableRow } from '@mui/material';

const AiaTableRow = ({
  children,
}: {
  children: React.ReactNode;
}) => (
  <TableRow hover>
    {children}
  </TableRow>
);

export { AiaTableRow };