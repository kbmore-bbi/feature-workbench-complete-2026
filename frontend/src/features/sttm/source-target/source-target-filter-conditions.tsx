"use client";

import { useState } from "react";
import FilterAltOutlinedIcon from "@mui/icons-material/FilterAltOutlined";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import {
 Box,
 Button,
 MenuItem,
 Select,
 Typography,
 type SelectChangeEvent,
} from "@mui/material";

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

 const handleSelectChange =
  (
   rowId: string,
   key: keyof Omit<ConditionRow, "id" | "branchLabel">
  ) =>
  (event: SelectChangeEvent) => {
   updateRow(rowId, key, event.target.value);
  };

 return (
  <Box
   sx={{
    mt: 2,
    borderTop: "1px solid var(--color-soft-border)",
    backgroundColor: "var(--color-surface)",
   }}
  >
   <Box
    sx={{
     px: 2,
     py: 1.5,
     display: "flex",
     alignItems: "center",
     justifyContent: "space-between",
     borderBottom: "1px solid var(--color-soft-border)",
    }}
   >
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
     <FilterAltOutlinedIcon
      sx={{ fontSize: 16, color: "var(--color-title)" }}
     />
     <Typography
      sx={{
       fontSize: "13px",
       fontWeight: 700,
       color: "var(--color-title)",
      }}
     >
      Filter Conditions
     </Typography>

     <Typography
      sx={{
       fontSize: "11px",
       color: "var(--color-muted)",
      }}
     >
      Hierarchical WHERE clause builder
     </Typography>

     <Box
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
     </Box>
    </Box>

    <Button
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
    </Button>
   </Box>

   <Box sx={{ px: 2, py: 1.5 }}>
    <Box
     sx={{
      display: "grid",
      gridTemplateColumns: "80px 1fr",
      gap: 2,
      pb: 1,
     }}
    >
     <Typography
      sx={{
       fontSize: "10px",
       fontWeight: 700,
       letterSpacing: "0.05em",
       color: "var(--color-muted)",
      }}
     >
      #
     </Typography>
     <Typography
      sx={{
       fontSize: "10px",
       fontWeight: 700,
       letterSpacing: "0.05em",
       color: "var(--color-muted)",
      }}
     >
      CONDITION / GROUP
     </Typography>
    </Box>

    <Box
     sx={{
      display: "grid",
      gridTemplateColumns: "80px 1fr",
      gap: 2,
      alignItems: "center",
      py: 1,
      borderBottom: "1px solid var(--color-soft-border)",
     }}
    >
     <Typography
      sx={{
       fontSize: "12px",
       fontWeight: 700,
       color: "var(--color-title)",
      }}
     >
      1
     </Typography>

     <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
      <Select
       value="all"
       IconComponent={KeyboardArrowDownRoundedIcon}
       sx={selectSx}
      >
       <MenuItem value="all">all</MenuItem>
       <MenuItem value="any">any</MenuItem>
      </Select>

      <Typography
       sx={{
        fontSize: "12px",
        color: "var(--color-text)",
       }}
      >
       of the conditions in this branch must match
      </Typography>
     </Box>
    </Box>

    {rows.map((row) => (
     <Box
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
      <Typography
       sx={{
        fontSize: "12px",
        fontWeight: 600,
        color: "var(--color-muted)",
       }}
      >
       {row.branchLabel}
      </Typography>

      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
       <Select
        value={row.field}
        onChange={handleSelectChange(row.id, "field")}
        IconComponent={KeyboardArrowDownRoundedIcon}
        sx={{ ...selectSx, minWidth: 160 }}
       >
        <MenuItem value="Customer Name">Customer Name</MenuItem>
        <MenuItem value="Country">Country</MenuItem>
        <MenuItem value="Order Status">Order Status</MenuItem>
        <MenuItem value="Amount">Amount</MenuItem>
       </Select>

       <Select
        value={row.operator}
        onChange={handleSelectChange(row.id, "operator")}
        IconComponent={KeyboardArrowDownRoundedIcon}
        sx={{ ...selectSx, minWidth: 130 }}
       >
        <MenuItem value="equals">equals</MenuItem>
        <MenuItem value="contains">contains</MenuItem>
        <MenuItem value="starts with">starts with</MenuItem>
        <MenuItem value="greater than">greater than</MenuItem>
       </Select>

       <Select
        value={row.value}
        onChange={handleSelectChange(row.id, "value")}
        IconComponent={KeyboardArrowDownRoundedIcon}
        sx={{ ...selectSx, minWidth: 140 }}
       >
        <MenuItem value="John">John</MenuItem>
        <MenuItem value="India">India</MenuItem>
        <MenuItem value="Active">Active</MenuItem>
        <MenuItem value="1000">1000</MenuItem>
       </Select>
      </Box>
     </Box>
    ))}
   </Box>
  </Box>
 );
}