"use client";

import Image from "next/image";
import DashboardRoundedIcon from "@mui/icons-material/DashboardRounded";
import FolderRoundedIcon from "@mui/icons-material/FolderRounded";
import AccountTreeRoundedIcon from "@mui/icons-material/AccountTreeRounded";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import { Avatar, Box, Button, Typography } from "@mui/material";
import { useRouter } from "next/navigation";

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

export default function DashboardSidebar() {
    const route = useRouter();
    return (
        <Box className="flex w-[260px] shrink-0 flex-col border-r border-[#E8ECF4] bg-white px-5 py-6">
            <Box className="flex items-center gap-3">
                

               
            </Box>

            <Box className="mt-10">
                <Typography className="mb-2 text-[12px] font-medium text-[#6B7280]">
                    LLM Model
                </Typography>

                <Box className="flex h-[38px] items-center justify-between rounded-full bg-[#F3F4F6] px-4">
                    <Typography className="text-[13px] font-medium text-[#111827]">
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
                className="mt-6 h-[36px] w-fit rounded-xl bg-black px-4 text-[13px] normal-case shadow-none hover:bg-[#111827]"
        onClick={()=> route.push('./home')}    >
                + New Mapping
            </Button>

           
        </Box>
    );
}
