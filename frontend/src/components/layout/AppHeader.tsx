"use client";

import Image from "next/image";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import { Avatar, Box, Typography } from "@mui/material";

type AppHeaderProps = {
    userName?: string;
    role?: string;
};

export default function AppHeader({
    userName = "Shane Watson",
    role = "Publisher",
}: AppHeaderProps) {
    const initials = userName
        .split(" ")
        .map((item) => item[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();

    return (
        <Box className="flex h-[68px] w-full items-center shrink-0 justify-between border-b border-[#E8ECF4] bg-white px-5">
            <Box className="flex items-center gap-3">
                <Box className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-white">
                    <Image
                        src="/images/focus_logo.png"
                        alt="STTM Builder Logo"
                        width={28}
                        height={28}
                        className="object-contain"
                    />
                </Box>

                <Typography className="text-[14px] font-semibold text-[#111827]">
                    STTM Builder
                </Typography>
            </Box>

            <Box className="flex items-center gap-3">
                <Avatar
                    sx={{
                        width: 28,
                        height: 28,
                        bgcolor: "#F3F4F6",
                        color: "#111827",
                        fontSize: 12,
                        fontWeight: 700,
                    }}
                >
                    {initials}
                </Avatar>

                <Box className="leading-tight">
                    <Typography className="text-[12px] font-semibold text-[#111827]">
                        {userName}
                    </Typography>
                    <Typography className="text-[11px] text-[#6B7280]">
                        {role}
                    </Typography>
                </Box>

                <KeyboardArrowDownRoundedIcon sx={{ fontSize: 18, color: "#6B7280" }} />
            </Box>
        </Box>
    );
}


