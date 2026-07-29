"use client";

import {
  AiaBox,
  AiaButton,
  AiaIconButton,
} from "@/components/ui";
import { AiaText } from "@/components/ui/aia-text";
import { CloseOutlinedIcon } from "@/utils/icons";

import type { HardcodedAttribute } from "./attributes-data";

type DeleteAttributeModalProps = {
  open: boolean;
  attribute: HardcodedAttribute | null;
  onClose: () => void;
  onConfirm: () => void;
};

export default function DeleteAttributeModal({
  open,
  attribute,
  onClose,
  onConfirm,
}: DeleteAttributeModalProps) {
  if (!open || !attribute) {
    return null;
  }

  return (
    <AiaBox
      role="dialog"
      aria-modal="true"
      aria-label="Delete attribute"
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 1400,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: 2,
      }}
    >
      <AiaBox
        onClick={onClose}
        sx={{
          position: "absolute",
          inset: 0,
          bgcolor: "rgba(15, 23, 42, 0.45)",
        }}
      />

      <AiaBox
        sx={{
          position: "relative",
          width: "100%",
          maxWidth: 440,
          borderRadius: "16px",
          bgcolor: "#FFFFFF",
          border: "1px solid #E5E7EB",
          boxShadow: "0 24px 60px rgba(15, 23, 42, 0.18)",
          overflow: "hidden",
        }}
      >
        <AiaBox
          sx={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 1.5,
            px: 2.5,
            py: 2,
            borderBottom: "1px solid #F1F5F9",
          }}
        >
          <AiaText sx={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>
            Delete Attribute?
          </AiaText>
          <AiaIconButton
            aria-label="Close delete attribute dialog"
            onClick={onClose}
            sx={{
              width: 32,
              height: 32,
              color: "#64748B",
              border: "1px solid #E5E7EB",
              borderRadius: "8px",
            }}
          >
            <CloseOutlinedIcon sx={{ fontSize: 18 }} />
          </AiaIconButton>
        </AiaBox>

        <AiaBox sx={{ px: 2.5, py: 2.25 }}>
          <AiaText sx={{ fontSize: 14, color: "#475569", lineHeight: 1.5 }}>
            Are you sure you want to delete{" "}
            <AiaText component="span" sx={{ fontWeight: 700, color: "#111827" }}>
              {attribute.attributeName}
            </AiaText>
            ? This action cannot be undone.
          </AiaText>
        </AiaBox>

        <AiaBox
          sx={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 1.25,
            px: 2.5,
            py: 2,
            borderTop: "1px solid #F1F5F9",
            bgcolor: "#FAFBFC",
          }}
        >
          <AiaButton
            variant="outlined"
            onClick={onClose}
            sx={{
              minWidth: 96,
              height: 38,
              borderRadius: "10px",
              borderColor: "#E5E7EB",
              color: "#374151",
              fontSize: 13,
              fontWeight: 600,
              textTransform: "none",
              "&:hover": {
                borderColor: "#D1D5DB",
                bgcolor: "#F9FAFB",
              },
            }}
          >
            Cancel
          </AiaButton>
          <AiaButton
            variant="contained"
            onClick={onConfirm}
            sx={{
              minWidth: 96,
              height: 38,
              borderRadius: "10px",
              textTransform: "none",
              fontSize: 13,
              fontWeight: 700,
              boxShadow: "none",
              bgcolor: "#DC2626",
              color: "#FFFFFF",
              border: "1px solid #DC2626",
              "&:hover": {
                bgcolor: "#B91C1C",
                boxShadow: "none",
              },
            }}
          >
            Delete
          </AiaButton>
        </AiaBox>
      </AiaBox>
    </AiaBox>
  );
}
