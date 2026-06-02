"use client";
import { Box } from "@mui/material";
import StatCard from "./StatCard";
import {
  AccountTreeOutlinedIcon,
  AutorenewOutlinedIcon,
  CheckCircleOutlinedIcon,
  FolderOutlinedIcon,
} from "@/utils/icons";

const stats = [
  {
    label: "Total Projects",
    value: 6,
    icon: <FolderOutlinedIcon sx={{ fontSize: 42 }} />,
  },
  {
    label: "Total Mappings",
    value: 26,
    icon: <AccountTreeOutlinedIcon sx={{ fontSize: 42 }} />,
  },
  {
    label: "In-progress Mappings",
    value: 7,
    icon: <AutorenewOutlinedIcon sx={{ fontSize: 42 }} />,
  },
  {
    label: "Published Mappings",
    value: 12,
    icon: <CheckCircleOutlinedIcon sx={{ fontSize: 42 }} />,
  },
];

export default function DashboardStats() {
  return (
    <Box className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
      {stats.map((item) => (
        <StatCard
          key={item.label}
          icon={item.icon}
          label={item.label}
          value={item.value}
        />
      ))}
    </Box>
  );
}
