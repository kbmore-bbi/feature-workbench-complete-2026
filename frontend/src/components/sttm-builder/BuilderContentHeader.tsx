"use client";

import EastRoundedIcon from "@mui/icons-material/EastRounded";
import PublishRoundedIcon from "@mui/icons-material/PublishRounded";
import VerifiedRoundedIcon from "@mui/icons-material/VerifiedRounded";
import { Box, Button, Typography } from "@mui/material";

type BuilderContentHeaderProps = {
  currentStep: 1 | 2;
  tableCount?: number;
  mappingCount?: number;
  onProceed?: () => void;
  onRunValidation?: () => void;
  onPublish?: () => void;
};

const steps = [
  { id: 1, label: "Select Tables" },
  { id: 2, label: "Map - Transform - Validate" },
] as const;

export default function BuilderContentHeader({
  currentStep,
  tableCount = 2,
  mappingCount = 0,
  onProceed,
  onRunValidation,
  onPublish,
}: BuilderContentHeaderProps) {
  return (
    <Box className="flex min-h-[52px] items-center justify-between gap-4 border-b border-[#E8ECF4] bg-white px-4">
      <Box className="flex min-w-0 items-center gap-2">
        {steps.map((step) => {
          const active = currentStep === step.id;
          const completed = currentStep > step.id;

          return (
            <Box
              key={step.id}
              className={`flex h-[28px] items-center gap-2 rounded-full px-3 ${active
                  ? "bg-[#111827] text-white"
                  : completed
                    ? "bg-[#F3F4F6] text-[#111827]"
                    : "bg-transparent text-[#6B7280]"
                }`}
            >
              <Box
                className={`flex h-[16px] w-[16px] items-center justify-center rounded-full text-[10px] font-semibold ${active
                    ? "bg-white text-[#111827]"
                    : completed
                      ? "bg-[#111827] text-white"
                      : "bg-[#E5E7EB] text-[#4B5563]"
                  }`}
              >
                {step.id}
              </Box>

              <Typography
                className={`whitespace-nowrap text-[14px] font-medium leading-none ${active ? "text-white" : "text-[#4B5563]"
                  }`}
              >
                {step.label} 
              </Typography> 
            </Box>
           
          );
        })}
      </Box>

      <Box className="flex shrink-0 items-center gap-3">
        <Box className="flex items-center gap-3">
          <Typography className="whitespace-nowrap text-[13px] font-medium text-[#111827]">
            {tableCount} tables
          </Typography>

          <Typography className="whitespace-nowrap text-[13px] font-medium text-[#6B7280]">
            {mappingCount} mappings
          </Typography>
        </Box>

        {currentStep === 1 ? (
          <Button
            variant="contained"
            endIcon={<EastRoundedIcon sx={{ fontSize: 14 }} />}
            onClick={onProceed}
            sx={{
              height: 30,
              minWidth: 138,
              px: 1.75,
              borderRadius: "9px",
              bgcolor: "#1D4ED8",
              boxShadow: "none",
              textTransform: "none",
              fontSize: 12,
              fontWeight: 600,
              lineHeight: 1,
              whiteSpace: "nowrap",
              "&:hover": {
                bgcolor: "#1E40AF",
                boxShadow: "none",
              },
              "& .MuiButton-endIcon": {
                ml: 0.75,
              },
            }}
          >
            Proceed to Mapping
          </Button>
        ) : (
          <>
            <Button
              variant="outlined"
              startIcon={<VerifiedRoundedIcon sx={{ fontSize: 14 }} />}
              onClick={onRunValidation}
              sx={{
                height: 30,
                minWidth: 128,
                px: 1.5,
                borderRadius: "9px",
                borderColor: "#D1D5DB",
                color: "#111827",
                bgcolor: "#FFFFFF",
                textTransform: "none",
                fontSize: 12,
                fontWeight: 600,
                lineHeight: 1,
                whiteSpace: "nowrap",
                "&:hover": {
                  borderColor: "#CBD5E1",
                  bgcolor: "#F8FAFC",
                },
                "& .MuiButton-startIcon": {
                  mr: 0.75,
                },
              }}
            >
              Run Validation
            </Button>

            <Button
              variant="contained"
              startIcon={<PublishRoundedIcon sx={{ fontSize: 14 }} />}
              onClick={onPublish}
              sx={{
                height: 30,
                minWidth: 132,
                px: 1.5,
                borderRadius: "9px",
                bgcolor: "#1D4ED8",
                boxShadow: "none",
                textTransform: "none",
                fontSize: 12,
                fontWeight: 600,
                lineHeight: 1,
                whiteSpace: "nowrap",
                "&:hover": {
                  bgcolor: "#1E40AF",
                  boxShadow: "none",
                },
                "& .MuiButton-startIcon": {
                  mr: 0.75,
                },
              }}
            >
              Publish Mapping
            </Button>
          </>
        )}
      </Box>
    </Box>
  );
}