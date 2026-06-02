"use client";
import { useState } from "react";
import { AccountTreeRoundedIcon, DashboardRoundedIcon, FolderRoundedIcon, KeyboardArrowDownRoundedIcon } from '@/utils/icons';




import { Box, Button, Typography } from "@mui/material";
import { useRouter } from "next/navigation";
import NewMappingDialog from "./NewMappingDialog";

const navItems = [
    {
        label: "Dashboard",
        icon: <DashboardRoundedIcon sx={{ fontSize: 18 }} />,
        active: true,
    },
    {
        label: "Projects",
        icon: <FolderRoundedIcon sx={{ fontSize: 18 }} />,
        active: false,
    },
    {
        label: "Mappings",
        icon: <AccountTreeRoundedIcon sx={{ fontSize: 18 }} />,
        active: false,
    },
];

type DashboardSidebarProps = {
    initialNewMappingOpen?: boolean;
};

export default function DashboardSidebar({
    initialNewMappingOpen = false,
}: DashboardSidebarProps) {
    const route = useRouter();
    const [isNewMappingOpen, setIsNewMappingOpen] = useState(initialNewMappingOpen);
    return (
        <>
            <Box
                className="flex w-[260px] shrink-0 flex-col px-5 py-6"
                sx={{
                    borderRight: "1px solid var(--color-soft-border)",
                    backgroundColor: "var(--color-surface)",
                }}
            >
                <Box className="flex items-center gap-3">
                </Box>

                <Box className="mt-10">
                    <Box className="flex h-[38px] items-center justify-between rounded-full bg-[#F3F4F6] px-4">
                        <Typography className="text-[13px] font-medium" sx={{ color: "var(--color-text)" }}>
                            Cortex
                        </Typography>
                        <KeyboardArrowDownRoundedIcon sx={{ fontSize: 18, color: "#4B5563" }} />
                    </Box>
                </Box>

                <Box className="mt-8 flex flex-col gap-1">
                    {navItems.map((item) => (
                        <Box
                            key={item.label}
                            className={`flex h-[42px] items-center gap-3 rounded-xl px-3 ${item.active ? "bg-[#F8FAFC]" : ""
                                }`}
                        >
                            <Box className={item.active ? "text-[#111827]" : "text-[#6B7280]"}>
                                {item.icon}
                            </Box>

                            <Typography
                                className={`text-[14px] ${item.active
                                        ? "font-semibold text-[#111827]"
                                        : "font-medium text-[#374151]"
                                    }`}
                            >
                                {item.label}
                            </Typography>
                        </Box>
                    ))}
                </Box>

                <Button
                    variant="contained"
                    href="/dashboard?newMapping=1"
                    sx={{ bgcolor: 'var(--aia-button-color)', textTransform: 'none', px: 5, py: 1.5, borderRadius: '10px', fontWeight: 700 }}
                    onClick={() => setIsNewMappingOpen(true)}
                >
                    + New Mapping
                </Button>
            </Box>

            <NewMappingDialog
                open={isNewMappingOpen}
                onClose={() => {
                    setIsNewMappingOpen(false);
                    if (initialNewMappingOpen) {
                        route.replace('/dashboard');
                    }
                }}
                onBuildManually={() => {
                    setIsNewMappingOpen(false);
                    route.push('/sttm/builder/new');
                }}
            />
        </>
    );
}
