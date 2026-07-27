"use client";
import { AiaBox, AiaButton, AiaSelect } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import { useState } from "react";
import { AddRoundedIcon, FilterAltOutlinedIcon, KeyboardArrowDownRoundedIcon } from '@/utils/icons';



type ConditionRow = {
  id: string;
  branchLabel: string;
  field: string;
  operator: string;
  value: string;
};

const initialRows: ConditionRow[] = [
  {
    id: "1.1",
    branchLabel: "1.1",
    field: "Customer Name",
    operator: "contains",
    value: "John",
  },
  {
    id: "1.2",
    branchLabel: "1.2",
    field: "Country",
    operator: "equals",
    value: "India",
  },
];

const BRANCH_MATCH_OPTIONS = [
  { label: "all", value: "all" },
  { label: "any", value: "any" },
];

const FIELD_OPTIONS = [
  { label: "Customer Name", value: "Customer Name" },
  { label: "Country", value: "Country" },
  { label: "Order Status", value: "Order Status" },
  { label: "Amount", value: "Amount" },
];

const OPERATOR_OPTIONS = [
  { label: "equals", value: "equals" },
  { label: "contains", value: "contains" },
  { label: "starts with", value: "starts with" },
  { label: "greater than", value: "greater than" },
];

const VALUE_OPTIONS = [
  { label: "John", value: "John" },
  { label: "India", value: "India" },
  { label: "Active", value: "Active" },
  { label: "1000", value: "1000" },
];

const selectSx = {
  height: 30,
  minWidth: 130,
  fontSize: "12px",
  backgroundColor: "var(--color-surface)",
  borderRadius: "4px",
  "& .MuiSelect-select": {
    py: "6px",
    px: "10px",
    fontSize: "12px",
    color: "var(--color-text)",
  },
  "& fieldset": {
    borderColor: "var(--color-border)",
  },
};

export default function SourceTargetFilterConditions() {
  const [rows, setRows] = useState(initialRows);

  const updateRow = (
    rowId: string,
    key: keyof Omit<ConditionRow, "id" | "branchLabel">,
    value: string
  ) => {
    setRows((prev) =>
      prev.map((row) => (row.id === rowId ? { ...row, [key]: value } : row))
    );
  };

  return (
    <AiaBox
      sx={{
        mt: 2,
        borderTop: "1px solid var(--color-soft-border)",
        backgroundColor: "var(--color-surface)",
      }}
    >
      <AiaBox
        sx={{
          px: 2,
          py: 1.5,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--color-soft-border)",
        }}
      >
        <AiaBox sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <FilterAltOutlinedIcon sx={{ fontSize: 16, color: "var(--color-title)" }} />
          <AiaText
            sx={{
              fontSize: "13px",
              fontWeight: 700,
              color: "var(--color-title)",
              textTransform: "capitalize",
            }}
          >
            Filter conditions
          </AiaText>

          <AiaText
            sx={{
              fontSize: "11px",
              color: "var(--color-muted)",
            }}
          >
            Hierarchical WHERE clause builder
          </AiaText>

          <AiaBox
            sx={{
              px: 1,
              py: 0.25,
              borderRadius: "999px",
              backgroundColor: "var(--color-surface-muted)",
              border: "1px solid var(--color-soft-border)",
              fontSize: "10px",
              fontWeight: 700,
              color: "var(--color-text)",
            }}
          >
            2 root groups
          </AiaBox>
        </AiaBox>

        <AiaButton
          variant="text"
          startIcon={<AddRoundedIcon sx={{ fontSize: 14 }} />}
          sx={{
            minWidth: 0,
            px: 1,
            fontSize: "12px",
            fontWeight: 600,
            textTransform: "none",
            color: "var(--color-primary-save)",
          }}
        >
          Add Group
        </AiaButton>
      </AiaBox>

      <AiaBox sx={{ px: 2, py: 1.5 }}>
        <AiaBox
          sx={{
            display: "grid",
            gridTemplateColumns: "80px 1fr",
            gap: 2,
            pb: 1,
          }}
        >
          <AiaText
            sx={{
              fontSize: "10px",
              fontWeight: 700,
              letterSpacing: "0.05em",
              color: "var(--color-muted)",
            }}
          >
            #
          </AiaText>
          <AiaText
            sx={{
              fontSize: "10px",
              fontWeight: 700,
              letterSpacing: "0.05em",
              color: "var(--color-muted)",
            }}
          >
            CONDITION / GROUP
          </AiaText>
        </AiaBox>

        <AiaBox
          sx={{
            display: "grid",
            gridTemplateColumns: "80px 1fr",
            gap: 2,
            alignItems: "center",
            py: 1,
            borderBottom: "1px solid var(--color-soft-border)",
          }}
        >
          <AiaText
            sx={{
              fontSize: "12px",
              fontWeight: 700,
              color: "var(--color-title)",
            }}
          >
            1
          </AiaText>

          <AiaBox sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
            <AiaSelect
              value="all"
              options={BRANCH_MATCH_OPTIONS}
              iconComponent={KeyboardArrowDownRoundedIcon}
              fullWidth={false}
              sx={selectSx}
            />

            <AiaText sx={{ fontSize: "12px", color: "var(--color-text)" }}>
              of the conditions in this branch must match
            </AiaText>
          </AiaBox>
        </AiaBox>

        {rows.map((row) => (
          <AiaBox
            key={row.id}
            sx={{
              display: "grid",
              gridTemplateColumns: "80px 1fr",
              gap: 2,
              alignItems: "center",
              py: 1.25,
              borderBottom: "1px solid var(--color-soft-border)",
            }}
          >
            <AiaText
              sx={{
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--color-muted)",
              }}
            >
              {row.branchLabel}
            </AiaText>

            <AiaBox sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
              <AiaSelect
                value={row.field}
                options={FIELD_OPTIONS}
                onChange={(value) => updateRow(row.id, "field", value as string)}
                iconComponent={KeyboardArrowDownRoundedIcon}
                fullWidth={false}
                sx={{ ...selectSx, minWidth: 160 }}
              />

              <AiaSelect
                value={row.operator}
                options={OPERATOR_OPTIONS}
                onChange={(value) => updateRow(row.id, "operator", value as string)}
                iconComponent={KeyboardArrowDownRoundedIcon}
                fullWidth={false}
                sx={{ ...selectSx, minWidth: 130 }}
              />

              <AiaSelect
                value={row.value}
                options={VALUE_OPTIONS}
                onChange={(value) => updateRow(row.id, "value", value as string)}
                iconComponent={KeyboardArrowDownRoundedIcon}
                fullWidth={false}
                sx={{ ...selectSx, minWidth: 140 }}
              />
            </AiaBox>
          </AiaBox>
        ))}
      </AiaBox>
    </AiaBox>
  );
}