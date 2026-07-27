"use client";
import type { MouseEvent } from "react";
import { CloseRoundedIcon, SearchRoundedIcon } from '@/utils/icons';

import { Box, IconButton } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { AiaInput } from "@/components/ui/aia-input";

type AiaSearchboxProps = {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Shows a clear button when the field has a value. */
  clearable?: boolean;
  /** Shows the leading search icon. Off by default. */
  showSearchIcon?: boolean;
  fullWidth?: boolean;
  size?: "small" | "medium";
  sx?: SxProps<Theme>;
  inputSx?: SxProps<Theme>;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  className?: string;
};

const defaultWrapperSx: SxProps<Theme> = {
  display: "flex",
  alignItems: "center",
  gap: 1,
  width: "100%",
  px: 1.5,
  height: "40px",
  minHeight: "40px",
  boxSizing: "border-box",
  borderRadius: "8px",
  backgroundColor: "var(--color-surface-muted, #f3f4f6)",
  border: "1px solid #e5e7eb",
  transition: "background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease",
  "&:focus-within": {
    backgroundColor: "var(--color-surface, #ffffff)",
    borderColor: "var(--color-primary-save, #0073a0)",
    boxShadow: "0 0 0 2px rgba(0, 115, 160, 0.12)",
  },
};

const defaultInputSx: SxProps<Theme> = {
  "& .MuiFormControl-root": {
    margin: 0,
    display: "flex",
    alignItems: "center",
  },
  "& .MuiTextField-root": {
    margin: 0,
  },
  "& .MuiOutlinedInput-root": {
    backgroundColor: "transparent",
    padding: 0,
    minHeight: "unset",
    height: "auto",
    alignItems: "center",
    "& fieldset": {
      border: "none",
    },
  },
  "& .MuiInputBase-input": {
    padding: "0 !important",
    margin: 0,
    height: "auto",
    lineHeight: "20px",
    fontSize: 13,
    color: "var(--color-text, #111827)",
    "&::placeholder": {
      color: "var(--color-muted, #9ca3af)",
      opacity: 1,
    },
  },
};

export function AiaSearchbox({
  value = "",
  onChange,
  placeholder = "Search...",
  disabled = false,
  clearable = true,
  showSearchIcon = false,
  fullWidth = true,
  size = "small",
  sx,
  inputSx,
  onClick,
  className,
}: AiaSearchboxProps) {
  const showClear = clearable && !disabled && value.length > 0;

  const handleClear = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onChange?.("");
  };

  return (
    <Box
      className={className}
      onClick={onClick}
      sx={[
        defaultWrapperSx,
        ...(fullWidth === false ? [{ width: "auto" }] : []),
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {showSearchIcon ? (
        <SearchRoundedIcon
          sx={{
            fontSize: size === "small" ? 18 : 20,
            color: "var(--color-muted, #9ca3af)",
            flexShrink: 0,
            display: "block",
          }}
        />
      ) : null}
      <Box sx={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center" }}>
        <AiaInput
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          fullWidth
          size={size}
          sx={[
            defaultInputSx,
            ...(Array.isArray(inputSx) ? inputSx : inputSx ? [inputSx] : []),
          ]}
        />
      </Box>
      {showClear ? (
        <IconButton
          type="button"
          aria-label="Clear search"
          onClick={handleClear}
          sx={{
            p: 0.25,
            flexShrink: 0,
            color: "var(--color-muted, #9ca3af)",
            "&:hover": {
              color: "var(--color-text, #111827)",
              backgroundColor: "rgba(15, 23, 42, 0.06)",
            },
          }}
        >
          <CloseRoundedIcon sx={{ fontSize: size === "small" ? 16 : 18 }} />
        </IconButton>
      ) : null}
    </Box>
  );
}

export type { AiaSearchboxProps };
