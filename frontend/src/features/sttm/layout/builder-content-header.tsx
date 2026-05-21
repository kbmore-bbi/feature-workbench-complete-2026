// "use client";

// import EastRoundedIcon from "@mui/icons-material/EastRounded";
// import PublishRoundedIcon from "@mui/icons-material/PublishRounded";
// import VerifiedRoundedIcon from "@mui/icons-material/VerifiedRounded";
// import { Box, Button, Typography } from "@mui/material";

// type BuilderContentHeaderProps = {
//   currentStep: 1 | 2;
//   tableCount?: number;
//   mappingCount?: number;
//   onProceed?: () => void;
//   onRunValidation?: () => void;
//   onPublish?: () => void;
// };

// const steps = [
//   { id: 1, label: "Select Tables" },
//   { id: 2, label: "Map - Transform - Validate" },
// ] as const;

// export default function BuilderContentHeader({
//   currentStep,
//   tableCount = 2,
//   mappingCount = 0,
//   onProceed,
//   onRunValidation,
//   onPublish,
// }: BuilderContentHeaderProps) {
//   return (
//     <Box className="flex min-h-[52px] items-center justify-between gap-4 border-b border-[#E8ECF4] bg-white px-4">
//       <Box className="flex min-w-0 items-center gap-2">
//         {steps.map((step) => {
//           const active = currentStep === step.id;
//           const completed = currentStep > step.id;

//           return (
//             <Box
//               key={step.id}
//               className={`flex h-[28px] items-center gap-2 rounded-full px-3 ${active
//                   ? "bg-[#111827] text-white"
//                   : completed
//                     ? "bg-[#F3F4F6] text-[#111827]"
//                     : "bg-transparent text-[#6B7280]"
//                 }`}
//             >
//               <Box
//                 className={`flex h-[16px] w-[16px] items-center justify-center rounded-full text-[10px] font-semibold ${active
//                     ? "bg-white text-[#111827]"
//                     : completed
//                       ? "bg-[#111827] text-white"
//                       : "bg-[#E5E7EB] text-[#4B5563]"
//                   }`}
//               >
//                 {step.id}
//               </Box>

//               <Typography
//                 className={`whitespace-nowrap text-[14px] font-medium leading-none ${active ? "text-white" : "text-[#4B5563]"
//                   }`}
//               >
//                 {step.label} 
//               </Typography> 
//             </Box>
           
//           );
//         })}
//       </Box>

//       <Box className="flex shrink-0 items-center gap-3">
//         <Box className="flex items-center gap-3">
//           <Typography className="whitespace-nowrap text-[13px] font-medium text-[#111827]">
//             {tableCount} tables
//           </Typography>

//           <Typography className="whitespace-nowrap text-[13px] font-medium text-[#6B7280]">
//             {mappingCount} mappings
//           </Typography>
//         </Box>

//         {currentStep === 1 ? (
//           <Button
//             variant="contained"
//             endIcon={<EastRoundedIcon sx={{ fontSize: 14 }} />}
//             onClick={onProceed}
//             sx={{
//               height: 30,
//               minWidth: 138,
//               px: 1.75,
//               borderRadius: "9px",
//               bgcolor: "#1D4ED8",
//               boxShadow: "none",
//               textTransform: "none",
//               fontSize: 12,
//               fontWeight: 600,
//               lineHeight: 1,
//               whiteSpace: "nowrap",
//               "&:hover": {
//                 bgcolor: "#1E40AF",
//                 boxShadow: "none",
//               },
//               "& .MuiButton-endIcon": {
//                 ml: 0.75,
//               },
//             }}
//           >
//             Proceed to Mapping
//           </Button>
//         ) : (
//           <>
//             <Button
//               variant="outlined"
//               startIcon={<VerifiedRoundedIcon sx={{ fontSize: 14 }} />}
//               onClick={onRunValidation}
//               sx={{
//                 height: 30,
//                 minWidth: 128,
//                 px: 1.5,
//                 borderRadius: "9px",
//                 borderColor: "#D1D5DB",
//                 color: "#111827",
//                 bgcolor: "#FFFFFF",
//                 textTransform: "none",
//                 fontSize: 12,
//                 fontWeight: 600,
//                 lineHeight: 1,
//                 whiteSpace: "nowrap",
//                 "&:hover": {
//                   borderColor: "#CBD5E1",
//                   bgcolor: "#F8FAFC",
//                 },
//                 "& .MuiButton-startIcon": {
//                   mr: 0.75,
//                 },
//               }}
//             >
//               Run Validation
//             </Button>

//             <Button
//               variant="contained"
//               startIcon={<PublishRoundedIcon sx={{ fontSize: 14 }} />}
//               onClick={onPublish}
//               sx={{
//                 height: 30,
//                 minWidth: 132,
//                 px: 1.5,
//                 borderRadius: "9px",
//                 bgcolor: "#1D4ED8",
//                 boxShadow: "none",
//                 textTransform: "none",
//                 fontSize: 12,
//                 fontWeight: 600,
//                 lineHeight: 1,
//                 whiteSpace: "nowrap",
//                 "&:hover": {
//                   bgcolor: "#1E40AF",
//                   boxShadow: "none",
//                 },
//                 "& .MuiButton-startIcon": {
//                   mr: 0.75,
//                 },
//               }}
//             >
//               Publish Mapping
//             </Button>
//           </>
//         )}
//       </Box>
//     </Box>
//   );
// }






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
  onStepChange?: (step: 1 | 2) => void;
  embedded?: boolean;
};

const steps = [
  { id: 1 as const, label: "Select Tables" },
  { id: 2 as const, label: "Map - Transform - Validate" },
];

export default function BuilderContentHeader({
  currentStep,
  tableCount = 2,
  mappingCount = 0,
  onProceed,
  onRunValidation,
  onPublish,
  onStepChange,
  embedded = false,
}: BuilderContentHeaderProps) {
  return (
    <Box
      sx={{
        minHeight: embedded ? 40 : 54,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 2,
        px: embedded ? 0 : 2,
        borderBottom: embedded ? "none" : "1px solid var(--color-soft-border)",
        backgroundColor: embedded ? "transparent" : "var(--color-surface)",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, minWidth: 0 }}>
        {steps.map((step) => {
          const active = currentStep === step.id;
          const completed = currentStep > step.id;

          return (
            <Box
              key={step.id}
              onClick={() => onStepChange?.(step.id)}
              sx={{
                height: 30,
                px: 1.75,
                borderRadius: "999px",
                display: "flex",
                alignItems: "center",
                gap: 1,
                cursor: "pointer",
                backgroundColor: active
                  ? "var(--color-header-bg)"
                  : completed
                  ? "var(--color-surface-muted)"
                  : "transparent",
                color: active ? "#060505" : "#282323",
              }}
            >
              <Box
                sx={{
                  width: 16,
                  height: 16,
                  borderRadius: "999px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "10px",
                  fontWeight: 700,
                  backgroundColor: active
                    ? "var(--color-header-text)"
                    : completed
                    ? "var(--color-header-bg)"
                    : "var(--color-border)",
                  color: active ? "var(--color-header-bg)" : completed ? "#060505" : "#282323",
                  lineHeight: 1,
                }}
              >
                {step.id}
              </Box>

              <Typography
                sx={{
                  fontSize: "14px",
                  fontWeight: 600,
                  lineHeight: 1,
                  whiteSpace: "nowrap",
                }}
              >
                {step.label}
              </Typography>
            </Box>
          );
        })}
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
        <Typography sx={{ fontSize: "12px", fontWeight: 600, color: "var(--color-title)" }}>
          {tableCount} tables
        </Typography>

        <Typography sx={{ fontSize: "12px", fontWeight: 600, color: "var(--color-muted)" }}>
          {mappingCount} mappings
        </Typography>

        {currentStep === 1 ? (
          <Button
            variant="contained"
            endIcon={<EastRoundedIcon sx={{ fontSize: 14 }} />}
            onClick={onProceed}
            sx={{
              height: 30,
              minWidth: 136,
              px: 1.75,
              borderRadius: "4px",
              backgroundColor: "var(--color-primary-save)",
              border: "1px solid var(--color-primary-save)",
              color: "#ffffff",
              fontSize: "12px",
              fontWeight: 600,
              whiteSpace: "nowrap",
              textTransform: "none",
              boxShadow: "none",
              "&:hover": {
                backgroundColor: "var(--color-primary-hover)",
                borderColor: "var(--color-primary-hover)",
                boxShadow: "none",
              },
            }}
          >
            Proceed to Mapping
          </Button>
        ) : (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Button
              variant="outlined"
              startIcon={<VerifiedRoundedIcon sx={{ fontSize: 14 }} />}
              onClick={onRunValidation}
              sx={{
                height: 30,
                minWidth: 124,
                px: 1.5,
                borderRadius: "4px",
                backgroundColor: "transparent",
                border: "1px solid var(--color-primary-save)",
                color: "var(--color-text)",
                fontSize: "12px",
                fontWeight: 600,
                whiteSpace: "nowrap",
                textTransform: "none",
                "&:hover": {
                  backgroundColor: "transparent",
                  borderColor: "var(--color-primary-hover)",
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
                borderRadius: "4px",
                backgroundColor: "var(--color-primary-save)",
                border: "1px solid var(--color-primary-save)",
                color: "#ffffff",
                fontSize: "12px",
                fontWeight: 600,
                whiteSpace: "nowrap",
                textTransform: "none",
                boxShadow: "none",
                "&:hover": {
                  backgroundColor: "var(--color-primary-hover)",
                  borderColor: "var(--color-primary-hover)",
                  boxShadow: "none",
                },
              }}
            >
              Publish Mapping
            </Button>
          </Box>
        )}
      </Box>
    </Box>
  );
}
