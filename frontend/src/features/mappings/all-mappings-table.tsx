"use client";
import {
  AiaAvatar,
  AiaBox,
  AiaButton,
  AiaTableBody,
  AiaTableCellPrimitive,
  AiaTableContainer,
  AiaTableHead,
  AiaTablePrimitive,
  AiaTableRowPrimitive,
} from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import CircularProgress from '@mui/material/CircularProgress';

import {
  AutoAwesomeRoundedIcon,
  EastRoundedIcon,
  GridViewRoundedIcon,
} from '@/utils/icons';

import type { AllMappingListItem } from "./all-mappings-data";
import MappingStatusBadge from "./mapping-status-badge";
import {
  MAPPINGS_BORDER_RADIUS,
  mappingsBodyCellSx,
  mappingsBodyEmphasisSx,
  mappingsHeaderCellSx,
  mappingsMutedTextSx,
  mappingsPrimaryColor,
  mappingsPrimaryTextColor,
} from "./mappings-ui-styles";

const TABLE_COLUMNS = [
  { key: "index", label: "#", align: "left" as const },
  { key: "mapping", label: "MAPPING", align: "left" as const },
  { key: "aiSummary", label: "AI SUMMARY", align: "left" as const },
  { key: "createdBy", label: "CREATED BY", align: "left" as const },
  { key: "dateTime", label: "DATE & TIME", align: "left" as const },
  { key: "open", label: "OPEN", align: "right" as const },
];

const mappingsTableContainerSx = {
  maxHeight: "calc(100vh - 320px)",
  overflow: "auto",
  "& table": {
    minWidth: 1100,
  },
  "& .MuiTableCell-root": {
    borderBottom: "1px solid #edf2f7",
    py: 1.5,
    px: 1.5,
    verticalAlign: "top",
    ...mappingsBodyCellSx,
  },
  "& .MuiTableHead-root .MuiTableCell-root": {
    borderBottom: "1px solid #e5e7eb",
    py: 1.25,
    ...mappingsHeaderCellSx,
    backgroundColor: "#fafafa",
    position: "sticky",
    top: 0,
    zIndex: 1,
  },
} as const;

type AllMappingsTableProps = {
  rows: AllMappingListItem[];
  onOpen: (item: AllMappingListItem) => void;
  isLoading?: boolean;
};

export default function AllMappingsTable({ rows, onOpen, isLoading = false }: AllMappingsTableProps) {
  return (
    <AiaTableContainer sx={mappingsTableContainerSx}>
      <AiaTablePrimitive size="small" stickyHeader>
        <AiaTableHead>
          <AiaTableRowPrimitive>
            {TABLE_COLUMNS.map((column) => (
              <AiaTableCellPrimitive key={column.key} align={column.align}>
                {column.label}
              </AiaTableCellPrimitive>
            ))}
          </AiaTableRowPrimitive>
        </AiaTableHead>
        <AiaTableBody>
          {isLoading ? (
            <AiaTableRowPrimitive>
              <AiaTableCellPrimitive colSpan={TABLE_COLUMNS.length}>
                <AiaBox
                  role="status"
                  aria-label="Loading mappings"
                  sx={{ minHeight: 176, display: "flex", alignItems: "center", justifyContent: "center", gap: 1.25 }}
                >
                  <CircularProgress size={20} thickness={4.5} />
                  <AiaText sx={{ color: "#64748B", fontSize: 13, fontWeight: 600 }}>
                    Loading mappings...
                  </AiaText>
                </AiaBox>
              </AiaTableCellPrimitive>
            </AiaTableRowPrimitive>
          ) : rows.length === 0 ? (
            <AiaTableRowPrimitive>
              <AiaTableCellPrimitive colSpan={TABLE_COLUMNS.length}>
                <AiaBox sx={{ py: 6, textAlign: "center" }}>
                  <AiaText sx={{ color: "#6B7280", fontSize: 14, fontWeight: 600 }}>
                    No saved mappings found.
                  </AiaText>
                  <AiaText sx={{ color: "#9CA3AF", fontSize: 13, mt: 0.75 }}>
                    Create or publish an STTM to see it here.
                  </AiaText>
                </AiaBox>
              </AiaTableCellPrimitive>
            </AiaTableRowPrimitive>
          ) : (
            rows.map((item) => (
            <AiaTableRowPrimitive key={item.id} hover>
              <AiaTableCellPrimitive sx={{ width: 40, ...mappingsMutedTextSx }}>
                {item.index}
              </AiaTableCellPrimitive>

              <AiaTableCellPrimitive sx={{ minWidth: 260 }}>
                <AiaBox className="flex items-start gap-2">
                  <AiaBox
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center"
                    sx={{
                      backgroundColor: "#F3F4F6",
                      color: "#6B7280",
                      borderRadius: MAPPINGS_BORDER_RADIUS,
                    }}
                  >
                    <GridViewRoundedIcon sx={{ fontSize: 14 }} />
                  </AiaBox>

                  <AiaBox className="min-w-0">
                    <AiaText sx={{ ...mappingsBodyEmphasisSx, textTransform: "uppercase" }}>
                      {item.name}
                    </AiaText>
                    <AiaText className="mt-0.5" sx={mappingsBodyCellSx}>
                      {item.qualifiedName}
                    </AiaText>
                    <AiaBox className="mt-1.5 flex flex-wrap items-center gap-2">
                      <MappingStatusBadge status={item.status} />
                      <AiaText sx={mappingsMutedTextSx}>
                        {item.projectName}
                      </AiaText>
                    </AiaBox>
                  </AiaBox>
                </AiaBox>
              </AiaTableCellPrimitive>

              <AiaTableCellPrimitive sx={{ minWidth: 300, maxWidth: 400 }}>
                <AiaBox className="flex items-start gap-1.5">
                  <AutoAwesomeRoundedIcon
                    sx={{ fontSize: 12, color: "#6366F1", mt: "1px", flexShrink: 0 }}
                  />
                  <AiaText sx={mappingsBodyCellSx}>{item.aiSummary}</AiaText>
                </AiaBox>
              </AiaTableCellPrimitive>

              <AiaTableCellPrimitive sx={{ minWidth: 160 }}>
                <AiaBox className="flex items-center gap-2">
                  <AiaAvatar
                    sx={{
                      width: 28,
                      height: 28,
                      bgcolor: mappingsPrimaryColor,
                      color: mappingsPrimaryTextColor,
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {item.createdBy.initials}
                  </AiaAvatar>
                  <AiaText sx={mappingsBodyCellSx}>{item.createdBy.name}</AiaText>
                </AiaBox>
              </AiaTableCellPrimitive>

              <AiaTableCellPrimitive sx={{ minWidth: 130, whiteSpace: "nowrap" }}>
                <AiaText sx={mappingsBodyEmphasisSx}>{item.createdAt}</AiaText>
                <AiaText className="mt-0.5" sx={mappingsMutedTextSx}>
                  {item.relativeTime}
                </AiaText>
              </AiaTableCellPrimitive>

              <AiaTableCellPrimitive align="right" sx={{ width: 96 }}>
                <AiaButton
                  variant="outlined"
                  size="small"
                  color="primary"
                  customColor="var(--aia-button-color)"
                  customBorderColor="var(--aia-button-color)"
                  endIcon={<EastRoundedIcon />}
                  onClick={() => onOpen(item)}
                >
                  Open
                </AiaButton>
              </AiaTableCellPrimitive>
            </AiaTableRowPrimitive>
            ))
          )}
        </AiaTableBody>
      </AiaTablePrimitive>
    </AiaTableContainer>
  );
}
