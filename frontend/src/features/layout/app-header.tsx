"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import DarkModeRoundedIcon from "@mui/icons-material/DarkModeRounded";
import LightModeRoundedIcon from "@mui/icons-material/LightModeRounded";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import { Avatar, Box, IconButton, Tooltip, Typography } from "@mui/material";
import { useThemeMode } from "@/app/Providers";
import Link from 'next/link';
import { authService } from "@/services/authService";
import type { UserSession } from "@/types/user";

type AppHeaderProps = {
  userName?: string;
  role?: string;
};

export default function AppHeader({
  userName = "Shane Watson",
  role = "Publisher",
}: AppHeaderProps) {
  const { mode, toggleMode } = useThemeMode();
  const [session, setSession] = useState<UserSession | null>(null);

  useEffect(() => {
    let cancelled = false;

    authService
      .getSession()
      .then((response) => {
        if (!cancelled) {
          setSession(response);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSession(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const resolvedUserName = session?.display_name?.trim() || session?.email || userName;
  const resolvedRole = session?.app_persona
    ? `${session.app_persona.charAt(0)}${session.app_persona.slice(1).toLowerCase()}`
    : role;

  const initials = resolvedUserName
    .split(" ")
    .map((item) => item[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="flex h-[60px] w-full shrink-0 items-center justify-between bg-[var(--color-header-bg)] px-5 text-[var(--color-header-text)]">
      <Box className="flex items-center gap-3">
         <Box className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl bg-white">
        <Link href="/home">
          <Image
            src="/images/focus_home_logo.svg"
            alt="STTM Builder Logo"
            width={44}
            height={44}
            className="object-contain"
            style={{ width: "auto", height: "auto" }}
          />
        </Link>

      </Box>

      <Typography className="font-[var(--font-body)] text-[16px] font-semibold ">
        AIA Migration Workbench
      </Typography>
    </Box>

    <Box className="flex items-center gap-3">
      <Tooltip title={mode === "light" ? "Switch to dark mode" : "Switch to light mode"}>
        <IconButton
          onClick={toggleMode}
          aria-label="Toggle light and dark theme"
          sx={{
            width: 32,
            height: 32,
            borderRadius: "4px",
            border: "1px solid rgba(255,255,255,0.28)",
            "&:hover": {
              backgroundColor: "rgba(115, 109, 109, 0.08)",
            },
          }}
        >
          {mode === "light" ? (
            <DarkModeRoundedIcon sx={{ fontSize: 18 }} />
          ) : (
            <LightModeRoundedIcon sx={{ fontSize: 18 }} />
          )}
        </IconButton>
      </Tooltip>

      <Avatar
        sx={{
          width: 28,
          height: 28,
          bgcolor: "#ffffff",
          color: "#2d2d2d",
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        {initials}
      </Avatar>

      <Box className="leading-tight">
        <Typography className="font-[var(--font-body)] text-[12px] font-semibold ">
          {resolvedUserName}
        </Typography>
        <Typography className="font-[var(--font-body)] text-[11px]/70">
          {resolvedRole}
        </Typography>
      </Box>

      <KeyboardArrowDownRoundedIcon sx={{ fontSize: 18, color: "#ffffff" }} />
    </Box>
    </header>
  );
}
