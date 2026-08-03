"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Form state must hydrate when edit-modal inputs change. */

import { useEffect, useMemo, useState } from "react";
import {
  AiaBox,
  AiaButton,
  AiaIconButton,
  AiaInput,
  AiaSelect,
  AiaStack,
} from "@/components/ui";
import { AiaText } from "@/components/ui/aia-text";
import { CloseOutlinedIcon, LockOutlinedIcon } from "@/utils/icons";

import {
  ATTRIBUTE_TYPE_OPTIONS,
  getAttributeNameValidationError,
  isValidAttributeName,
  type AttributeType,
  type HardcodedAttribute,
  type NewAttributeFormValues,
} from "./attributes-data";

type NewAttributeModalProps = {
  open: boolean;
  projectName: string;
  mode?: "create" | "edit";
  initialValues?: HardcodedAttribute | null;
  onClose: () => void;
  onSubmit: (values: NewAttributeFormValues) => void;
};

const fieldLabelSx = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.08em",
  color: "#94A3B8",
  mb: 0.75,
} as const;

const inputSx = {
  "& .MuiOutlinedInput-root": {
    borderRadius: "10px",
    fontSize: 14,
    color: "#111827",
    backgroundColor: "#FFFFFF",
    "& fieldset": {
      borderColor: "#E5E7EB",
    },
    "&:hover fieldset": {
      borderColor: "#C7D2FE",
    },
    "&.Mui-focused fieldset": {
      borderColor: "#818CF8",
      borderWidth: "1px",
    },
    "&.Mui-disabled": {
      backgroundColor: "#F8FAFC",
    },
  },
  "& .MuiInputBase-input::placeholder": {
    color: "#94A3B8",
    opacity: 1,
  },
} as const;

const inputErrorSx = {
  ...inputSx,
  "& .MuiOutlinedInput-root": {
    ...inputSx["& .MuiOutlinedInput-root"],
    "& fieldset": {
      borderColor: "#FCA5A5",
    },
    "&:hover fieldset": {
      borderColor: "#F87171",
    },
    "&.Mui-focused fieldset": {
      borderColor: "#EF4444",
      borderWidth: "1px",
    },
  },
} as const;

const fieldHintSx = {
  fontSize: 11,
  color: "#94A3B8",
  mt: 0.75,
  lineHeight: 1.4,
} as const;

const fieldErrorSx = {
  fontSize: 11,
  color: "#DC2626",
  mt: 0.75,
  lineHeight: 1.4,
} as const;

export default function NewAttributeModal({
  open,
  projectName,
  mode = "create",
  initialValues = null,
  onClose,
  onSubmit,
}: NewAttributeModalProps) {
  const isEdit = mode === "edit";
  const [attributeName, setAttributeName] = useState("");
  const [attributeType, setAttributeType] = useState<AttributeType | "">("");
  const [attributeValue, setAttributeValue] = useState("");
  const [attributeNameTouched, setAttributeNameTouched] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (isEdit && initialValues) {
      setAttributeName(initialValues.attributeName);
      setAttributeType(initialValues.attributeType);
      setAttributeValue(initialValues.attributeValue);
      setAttributeNameTouched(false);
      return;
    }
    setAttributeName("");
    setAttributeType("");
    setAttributeValue("");
    setAttributeNameTouched(false);
  }, [open, isEdit, initialValues]);

  const attributeNameError = useMemo(
    () => (attributeNameTouched ? getAttributeNameValidationError(attributeName) : null),
    [attributeName, attributeNameTouched],
  );

  const canSubmit = useMemo(
    () =>
      Boolean(
        isValidAttributeName(attributeName) &&
          attributeType &&
          projectName.trim() &&
          attributeValue.trim(),
      ),
    [attributeName, attributeType, attributeValue, projectName],
  );

  const handleAttributeNameChange = (value: string) => {
    setAttributeName(value.replace(/[^A-Za-z0-9_]/g, ""));
  };

  const handleClose = () => {
    onClose();
  };

  const handleSubmit = () => {
    setAttributeNameTouched(true);
    if (!canSubmit || !attributeType) {
      return;
    }
    onSubmit({
      attributeName: attributeName.trim(),
      attributeType,
      projectName: projectName.trim(),
      attributeValue: attributeValue.trim(),
    });
    onClose();
  };

  if (!open) {
    return null;
  }

  const title = isEdit ? "Edit Attribute" : "New Attribute";
  const submitLabel = isEdit ? "Save" : "Add";

  return (
    <AiaBox
      role="dialog"
      aria-modal="true"
      aria-label={title}
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
        onClick={handleClose}
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
          maxWidth: 480,
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
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1.5,
            px: 2.5,
            py: 2,
            borderBottom: "1px solid #F1F5F9",
          }}
        >
          <AiaStack direction="row" spacing={1.25} sx={{ alignItems: "center", minWidth: 0 }}>
            <AiaBox
              sx={{
                width: 36,
                height: 36,
                borderRadius: "10px",
                bgcolor: "#F1F5F9",
                color: "#475569",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <LockOutlinedIcon sx={{ fontSize: 18 }} />
            </AiaBox>
            <AiaText sx={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>
              {title}
            </AiaText>
          </AiaStack>
          <AiaIconButton
            aria-label={`Close ${title.toLowerCase()} dialog`}
            onClick={handleClose}
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
          <AiaBox sx={{ mb: 2 }}>
            <AiaText sx={fieldLabelSx}>ATTRIBUTE NAME *</AiaText>
            <AiaInput
              fullWidth
              value={attributeName}
              onChange={handleAttributeNameChange}
              onKeyDown={(event) => {
                if (event.key === " ") {
                  event.preventDefault();
                }
              }}
              inputProps={{
                onBlur: () => setAttributeNameTouched(true),
              }}
              placeholder="e.g. CUSTOMER_ID"
              sx={attributeNameError ? inputErrorSx : inputSx}
            />
            {attributeNameError ? (
              <AiaText sx={fieldErrorSx}>{attributeNameError}</AiaText>
            ) : (
              <AiaText sx={fieldHintSx}>
                Use letters, numbers, and underscores. Must start with a letter or underscore.
              </AiaText>
            )}
          </AiaBox>

          <AiaBox sx={{ mb: 2 }}>
            <AiaText sx={fieldLabelSx}>ATTRIBUTE TYPE *</AiaText>
            <AiaSelect
              fullWidth
              value={attributeType}
              options={[...ATTRIBUTE_TYPE_OPTIONS]}
              placeholder="Select attribute type"
              onChange={(value) => setAttributeType(value as AttributeType)}
            />
          </AiaBox>

          <AiaBox sx={{ mb: 2 }}>
            <AiaText sx={fieldLabelSx}>PROJECT NAME *</AiaText>
            <AiaInput
              fullWidth
              value={projectName}
              disabled
              sx={inputSx}
            />
          </AiaBox>

          <AiaBox>
            <AiaText sx={fieldLabelSx}>ATTRIBUTE VALUE *</AiaText>
            <AiaInput
              fullWidth
              multiline
              minRows={3}
              value={attributeValue}
              onChange={setAttributeValue}
              placeholder="Enter attribute value"
              sx={inputSx}
            />
          </AiaBox>
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
            onClick={handleClose}
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
            disabled={!canSubmit}
            onClick={handleSubmit}
            sx={{
              minWidth: 96,
              height: 38,
              borderRadius: "10px",
              textTransform: "none",
              fontSize: 13,
              fontWeight: 700,
              boxShadow: "none",
              bgcolor: canSubmit ? "#111827" : "#E5E7EB",
              color: canSubmit ? "#FFFFFF" : "#94A3B8",
              border: canSubmit ? "1px solid #111827" : "1px solid #E5E7EB",
              "&:hover": {
                bgcolor: canSubmit ? "#1F2937" : "#E5E7EB",
                boxShadow: "none",
              },
            }}
          >
            {submitLabel}
          </AiaButton>
        </AiaBox>
      </AiaBox>
    </AiaBox>
  );
}
