"use client";

import {
  AutoAwesomeRoundedIcon,
  EastRoundedIcon,
  GridViewRoundedIcon,
} from '@/utils/icons';
import {
  Avatar,
  Box,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import type { AllMappingListItem } from "./all-mappings-data";
import MappingStatusBadge from "./mapping-status-badge";
import {
  MAPPINGS_BORDER_RADIUS,
  MAPPINGS_CELL_FONT_SIZE,
  mappingsCellTextSx,
  mappingsHeaderTextSx,
} from "./mappings-ui-styles";

const TABLE_COLUMNS = [
  { key: "index", label: "#", align: "left" as const },
  { key: "mapping", label: "MAPPING", align: "left" as const },
  { key: "aiSummary", label: "AI SUMMARY", align: "left" as const },
  { key: "createdBy", label: "CREATED BY", align: "left" as const },
  { key: "dateTime", label: "DATE & TIME", align: "left" as const },
  { key: "open", label: "OPEN", align: "right" as const },
];

const cellTextSx = {
  ...mappingsCellTextSx,
  color: "#475569",
};

const cellTitleSx = {
  ...mappingsCellTextSx,
  color: "#111827",
  fontWeight: 600,
};

const createdByNameSx = {
  fontSize: "14px",
  fontWeight: 500,
  color: "#111827",
  lineHeight: 1.45,
};

type AllMappingsTableProps = {
  rows: AllMappingListItem[];
  onOpen: (item: AllMappingListItem) => void;
};

export default function AllMappingsTable({ rows, onOpen }: AllMappingsTableProps) {
  return (
    <TableContainer
      sx={{
        maxHeight: "calc(100vh - 320px)",
        overflow: "auto",
        "& table": {
          minWidth: 1100,
        },
        "& .MuiTableCell-root": {
          borderBottom: "1px solid #F1F5F9",
          py: 1.5,
          px: 1.5,
          verticalAlign: "top",
          ...mappingsCellTextSx,
        },
        "& .MuiTableHead-root .MuiTableCell-root": {
          borderBottom: "1px solid #E5E7EB",
          py: 1.25,
          ...mappingsHeaderTextSx,
          color: "#94A3B8",
          backgroundColor: "#FAFBFC",
          textTransform: "uppercase",
          position: "sticky",
          top: 0,
          zIndex: 1,
        },
      }}
    >
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            {TABLE_COLUMNS.map((column) => (
              <TableCell key={column.key} align={column.align}>
                {column.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
        {rows.map((item) => (
          <TableRow key={item.id} hover>
            <TableCell sx={{ width: 40, color: "#94A3B8" }}>
              {item.index}
            </TableCell>

            <TableCell sx={{ minWidth: 260 }}>
              <Box className="flex items-start gap-2">
                <Box
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center"
                  sx={{
                    backgroundColor: "#F3F4F6",
                    color: "#6B7280",
                    borderRadius: MAPPINGS_BORDER_RADIUS,
                  }}
                >
                  <GridViewRoundedIcon sx={{ fontSize: 14 }} />
                </Box>

                <Box className="min-w-0">
                  <Typography sx={{ ...cellTitleSx, textTransform: "uppercase" }}>
                    {item.name}
                  </Typography>
                  <Typography className="mt-0.5" sx={cellTextSx}>
                    {item.qualifiedName}
                  </Typography>
                  <Box className="mt-1.5 flex flex-wrap items-center gap-2">
                    <MappingStatusBadge status={item.status} />
                    <Typography sx={{ ...cellTextSx, color: "#94A3B8" }}>
                      {item.projectName}
                    </Typography>
                  </Box>
                </Box>
              </Box>
            </TableCell>

            <TableCell sx={{ minWidth: 300, maxWidth: 400 }}>
              <Box className="flex items-start gap-1.5">
                <AutoAwesomeRoundedIcon
                  sx={{ fontSize: 12, color: "#6366F1", mt: "1px", flexShrink: 0 }}
                />
                <Typography sx={cellTextSx}>{item.aiSummary}</Typography>
              </Box>
            </TableCell>

            <TableCell sx={{ minWidth: 160 }}>
              <Box className="flex items-center gap-2">
                <Avatar
                  sx={{
                    width: 28,
                    height: 28,
                    bgcolor: "#111827",
                    color: "#FFFFFF",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {item.createdBy.initials}
                </Avatar>
                <Typography sx={createdByNameSx}>{item.createdBy.name}</Typography>
              </Box>
            </TableCell>

            <TableCell sx={{ minWidth: 130, whiteSpace: "nowrap" }}>
              <Typography sx={cellTitleSx}>{item.createdAt}</Typography>
              <Typography className="mt-0.5" sx={{ ...cellTextSx, color: "#94A3B8" }}>
                {item.relativeTime}
              </Typography>
            </TableCell>

            <TableCell align="right" sx={{ width: 96 }}>
              <Button
                variant="contained"
                endIcon={<EastRoundedIcon sx={{ fontSize: 12, color: "#FFFFFF" }} />}
                onClick={() => onOpen(item)}
                sx={{
                  minWidth: 72,
                  height: 28,
                  px: 1.25,
                  bgcolor: "#111827",
                  color: "#FFFFFF",
                  border: "1px solid #111827",
                  borderRadius: MAPPINGS_BORDER_RADIUS,
                  textTransform: "none",
                  fontSize: MAPPINGS_CELL_FONT_SIZE,
                  fontWeight: 700,
                  boxShadow: "none",
                  "&:hover": {
                    bgcolor: "#1F2937",
                    borderColor: "#1F2937",
                    boxShadow: "none",
                  },
                }}
              >
                Open
              </Button>
            </TableCell>
          </TableRow>
        ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
