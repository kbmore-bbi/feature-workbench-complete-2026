"use client";

import { AiaBox, AiaButton, AiaStack } from "@/components/ui";
import { AiaText } from "@/components/ui/aia-text";
import { AddRoundedIcon, FileUploadOutlinedIcon } from "@/utils/icons";
import { SECTION_TITLE_SX, SECONDARY_TEXT_SX } from "@/config/typography-tokens";

type AttributesHeaderProps = {
  projectName: string;
  onImportAttributes: () => void;
  onCreateAttribute: () => void;
};

export default function AttributesHeader({
  projectName,
  onImportAttributes,
  onCreateAttribute,
}: AttributesHeaderProps) {
  return (
    <AiaBox
      sx={{
        display: "flex",
        flexDirection: { xs: "column", sm: "row" },
        alignItems: { xs: "flex-start", sm: "flex-start" },
        justifyContent: "space-between",
        gap: 2,
      }}
    >
      <AiaBox>
        <AiaText sx={{ ...SECTION_TITLE_SX, letterSpacing: "-0.02em" }}>
          Hardcode Value
        </AiaText>
        <AiaText sx={{ ...SECONDARY_TEXT_SX, mt: 0.75 }}>
          {projectName || "Unknown project"}
        </AiaText>
      </AiaBox>

      <AiaStack direction="row" spacing={1.25} sx={{ flexShrink: 0, flexWrap: "wrap" }}>
        <AiaButton
          variant="outlined"
          color="primary"
          size="medium"
          startIcon={<FileUploadOutlinedIcon sx={{ fontSize: 18 }} />}
          onClick={onImportAttributes}
          sx={{
            borderColor: "#E5E7EB",
            color: "#111827",
            bgcolor: "#FFFFFF",
            "&:hover": {
              borderColor: "#D1D5DB",
              bgcolor: "#F9FAFB",
            },
          }}
        >
          Import Attributes
        </AiaButton>
        <AiaButton
          variant="contained"
          color="primary"
          size="medium"
          startIcon={<AddRoundedIcon sx={{ fontSize: 18 }} />}
          onClick={onCreateAttribute}
        >
          Create Attribute
        </AiaButton>
      </AiaStack>
    </AiaBox>
  );
}
