"use client";
import { Box } from "@mui/material";
import StatCard from "./StatCard";
import { AccountTreeRoundedIcon, AutorenewRoundedIcon, FolderRoundedIcon, TaskAltRoundedIcon } from '@/utils/icons';

const stats = [
    {
        label: "Total Projects",
        value: 6,
        icon: <FolderRoundedIcon sx={{ fontSize: 20 }} />,
    },
    {
        label: "Total Mappings",
        value: 26,
        icon: <AccountTreeRoundedIcon sx={{ fontSize: 20 }} />,
    },
    {
        label: "In-progress Mappings",
        value: 7,
        icon: <AutorenewRoundedIcon sx={{ fontSize: 20 }} />,
    },
    {
        label: "Published Mappings",
        value: 12,
        icon: <TaskAltRoundedIcon sx={{ fontSize: 20 }} />,
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



