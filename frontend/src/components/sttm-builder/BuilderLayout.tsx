// "use client";

// import { useEffect, useState } from "react";
// import { Stack, Box, Paper } from "@mui/material";
// import AIAgentPanel from "./AIAgentPanel";
// import BuilderContentHeader from "./BuilderContentHeader";
// import DataSelectionPanel from "./DataSelectionPanel";
// import SourceTargetPanel from "./SourceTargetPanel";
// import { DataProvider } from "../../contexts/SttmBuilderContext";
// import { useRouter } from "next/navigation";
// import AppHeader from "../layout/AppHeader";

// export default function BuilderLayout() {
//     const [mounted, setMounted] = useState(false);
//     const router = useRouter();

//     useEffect(() => {
//         setMounted(true);
//     }, []);

//     if (!mounted) return null;

//     return (
//         <Box className="h-screen overflow-hidden bg-[var(--color-app-bg)">
//             <Paper
//                 elevation={0}
//                 className="mx-auto flex min-h-[calc(100vh-32px)] max-w-[1600px] flex-col overflow-hidden rounded-[24px] border border-[#E8ECF4] bg-white"
//             >
//                 <AppHeader />

//                 <DataProvider>
//                     <Box className="flex min-h-0 flex-1 bg-[#F9F9F9]">
//                         <DataSelectionPanel />

//                         <Box className="flex min-w-0 flex-1 flex-col">

//                             <BuilderContentHeader
//                                 currentStep={1}
//                                 tableCount={2}
//                                 mappingCount={0}
//                                 onProceed={() => router.push("/sttm/mapping")}
//                             />

//                             {/* <BuilderContentHeader
//                                 currentStep={2}
//                                 tableCount={2}
//                                 mappingCount={9}
//                                 onRunValidation={() => console.log("run validation")}
//                                 onPublish={() => console.log("publish mapping")}
//                             /> */}

//                             <Box className="flex min-h-0 flex-1 gap-4 p-4">
//                                 <Box sx={{ flex: 1, minWidth: 0 }}>
//                                     <Stack direction="row" spacing={2} sx={{ height: "100%" }}>
//                                         <SourceTargetPanel type="source" />
//                                         <SourceTargetPanel type="target" />
//                                     </Stack>
//                                 </Box>

//                                 <Box sx={{ width: 300, flexShrink: 0 }}>
//                                     <AIAgentPanel />
//                                 </Box>
//                             </Box>
//                         </Box>
//                     </Box>
//                 </DataProvider>
//             </Paper>
//         </Box>
//     );
// }




















"use client";

import { useEffect, useState } from "react";
import { Box, Paper, Stack, Typography } from "@mui/material";
import { DataProvider } from "../../contexts/SttmBuilderContext";
import AppHeader from "../layout/AppHeader";
import BuilderContentHeader from "./BuilderContentHeader";
import DataSelectionPanel from "./DataSelectionPanel";
import SourceTargetPanel from "./SourceTargetPanel";
import AIAgentPanel from "./AIAgentPanel";
import MappingQualityPanel from "./MappingQuality";
import SourceTargetAttributeList from "./SourceTargetAttributeList";
import SourceTargetAttributeMapping from "./SourceTargetAttributeMapping";

function StepTwoSidebarPlaceholder() {
  const sectionTitleStyle = {
    fontSize: "12px",
    fontWeight: 700,
    color: "var(--color-title)",
    mb: 1,
  };

  const rowStyle = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    px: 1.5,
    py: 0.75,
    borderRadius: "6px",
    "&:hover": {
      backgroundColor: "var(--color-surface-muted)",
    },
  };

  const chipStyle = {
    px: 1,
    py: 0.25,
    borderRadius: "4px",
    fontSize: "9px",
    fontWeight: 700,
    color: "#ffffff",
    backgroundColor: "var(--color-header-bg)",
    lineHeight: 1.4,
  };

  return (
    <Box
      sx={{
        width: 260,
        flexShrink: 0,
        borderRight: "1px solid var(--color-soft-border)",
        backgroundColor: "var(--color-surface)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* <Box sx={{ px: 2, py: 2, borderBottom: "1px solid var(--color-soft-border)" }}>
        <Typography sx={{ fontSize: "16px", fontWeight: 700, color: "var(--color-title)" }}>
          Cortex
        </Typography>
      </Box>

      <Box sx={{ flex: 1, overflowY: "auto", px: 2, py: 2 }}>
        <Box sx={{ mb: 3 }}>
          <Typography sx={sectionTitleStyle}>Source Columns</Typography>

          <Box sx={{ mb: 1.5 }}>
            <Typography sx={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text)" }}>
              Customers
            </Typography>
          </Box>

          {[
            ["CUST_ID", "INT"],
            ["NAME", "VARCHAR"],
            ["PHONE_NUM", "BIGINT"],
            ["LOCATION", "VARCHAR"],
          ].map(([name, type]) => (
            <Box key={name} sx={rowStyle}>
              <Typography sx={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text)" }}>
                {name}
              </Typography>
              <Box sx={chipStyle}>{type}</Box>
            </Box>
          ))}

          <Box sx={{ mt: 2, mb: 1.5 }}>
            <Typography sx={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text)" }}>
              Orders
            </Typography>
          </Box>

          {[
            ["DATE_KEY", "INT"],
            ["FULL_DATE", "DATE"],
            ["YEAR", "INT"],
            ["QUARTER", "INT"],
            ["MONTH", "INT"],
            ["WEEK", "INT"],
          ].map(([name, type]) => (
            <Box key={name} sx={rowStyle}>
              <Typography sx={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text)" }}>
                {name}
              </Typography>
              <Box sx={chipStyle}>{type}</Box>
            </Box>
          ))}
        </Box>

        <Box>
          <Typography sx={sectionTitleStyle}>Target Table</Typography>

          <Box
            sx={{
              border: "1px solid var(--color-soft-border)",
              borderRadius: "8px",
              backgroundColor: "var(--color-surface-muted)",
              px: 1.5,
              py: 1.25,
            }}
          >
            <Typography sx={{ fontSize: "10px", fontWeight: 700, color: "var(--color-muted)" }}>
              SELECTED TARGET
            </Typography>
            <Typography sx={{ mt: 0.75, fontSize: "11px", fontWeight: 700, color: "var(--color-title)" }}>
              DWH / FACT_SALES_UNIFIED
            </Typography>
          </Box>
        </Box>
      </Box> */}

      <SourceTargetAttributeList/>
    </Box>
  );
}

function StepTwoTablePlaceholder() {
  const typeChip = (value: string) => (
    <Box
      sx={{
        px: 1,
        py: 0.25,
        borderRadius: "4px",
        fontSize: "9px",
        fontWeight: 700,
        color: "#ffffff",
        backgroundColor: "var(--color-header-bg)",
        lineHeight: 1.4,
        display: "inline-flex",
      }}
    >
      {value}
    </Box>
  );

  const rows = [
    ["ORDER_ID", "orders.order_id", "BIGINT", "Direct", "Custom", "MAPPED"],
    ["CUSTOMER_KEY", "customers.customer_id", "INT", "Select...", "Custom", "UNMAPPED"],
    ["DATE_KEY", "orders.order_date", "INT", "Select...", "Custom", "UNMAPPED"],
    ["PRODUCT_KEY", "orders.product_id", "INT", "Select...", "Custom", "UNMAPPED"],
    ["AMOUNT", "orders.total_amount", "DECIMAL", "Select...", "Custom", "UNMAPPED"],
    ["QUANTITY", "orders.quantity", "SMALLINT", "Select...", "Custom", "UNMAPPED"],
    ["DISCOUNT", "orders.discount", "DECIMAL", "Select...", "Custom", "UNMAPPED"],
  ];

  return ( <SourceTargetAttributeMapping/>
    // <Paper
    //   elevation={0}
    //   sx={{
    //     flex: 1,
    //     minWidth: 0,
    //     height: "100%",
    //     border: "1px solid var(--color-soft-border)",
    //     borderRadius: "12px",
    //     backgroundColor: "var(--color-surface)",
    //     overflow: "hidden",
    //   }}
    // >
    //   <Box
    //     sx={{
    //       display: "grid",
    //       gridTemplateColumns: "180px 180px 90px 120px 100px 120px",
    //       gap: 2,
    //       px: 2,
    //       py: 1.5,
    //       borderBottom: "1px solid var(--color-soft-border)",
    //     }}
    //   >
    //     {[
    //       "TARGET COLUMN",
    //       "SOURCE COLUMN",
    //       "TYPE",
    //       "TRANSFORM RULE",
    //       "AI RULE",
    //       "STATUS",
    //     ].map((item) => (
    //       <Typography
    //         key={item}
    //         sx={{
    //           fontSize: "10px",
    //           fontWeight: 700,
    //           letterSpacing: "0.05em",
    //           color: "var(--color-muted)",
    //         }}
    //       >
    //         {item}
    //       </Typography>
    //     ))}
    //   </Box>

    //   <Box sx={{ overflowY: "auto", height: "calc(100% - 46px)" }}>
    //     {rows.map((row) => (
    //       <Box
    //         key={row[0]}
    //         sx={{
    //           display: "grid",
    //           gridTemplateColumns: "180px 180px 90px 120px 100px 120px",
    //           gap: 2,
    //           px: 2,
    //           py: 1.5,
    //           borderBottom: "1px solid var(--color-soft-border)",
    //           alignItems: "center",
    //         }}
    //       >
    //         <Typography sx={{ fontSize: "12px", fontWeight: 700, color: "var(--color-title)" }}>
    //           {row[0]}
    //         </Typography>

    //         <Typography sx={{ fontSize: "11px", color: "var(--color-text)" }}>
    //           {row[1]}
    //         </Typography>

    //         {typeChip(row[2])}

    //         <Typography sx={{ fontSize: "11px", color: "var(--color-text)" }}>
    //           {row[3]}
    //         </Typography>

    //         <Box
    //           sx={{
    //             width: "fit-content",
    //             px: 1.25,
    //             py: 0.5,
    //             borderRadius: "6px",
    //             fontSize: "10px",
    //             fontWeight: 700,
    //             color: "#ffffff",
    //             backgroundColor: "var(--color-header-bg)",
    //           }}
    //         >
    //           {row[4]}
    //         </Box>

    //         <Typography
    //           sx={{
    //             fontSize: "10px",
    //             fontWeight: 700,
    //             color: row[5] === "MAPPED" ? "#15803D" : "var(--color-muted)",
    //           }}
    //         >
    //           {row[5]}
    //         </Typography>
    //       </Box>
    //     ))}
    //   </Box>
    // </Paper>
  );
}

export default function BuilderLayout() {
  const [mounted, setMounted] = useState(false);
  const [currentStep, setCurrentStep] = useState<1 | 2>(1);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <Box className="app-page">
      <AppHeader />

      <DataProvider>
        <Box
          sx={{
            height: "calc(100vh - 60px)",
            display: "flex",
            overflow: "hidden",
            backgroundColor: "var(--color-app-bg)",
          }}
        >
          {currentStep === 1 ? <DataSelectionPanel /> : <StepTwoSidebarPlaceholder />}

          <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <BuilderContentHeader
              currentStep={currentStep}
              tableCount={2}
              mappingCount={currentStep === 1 ? 0 : 9}
              onProceed={() => setCurrentStep(2)}
              onRunValidation={() => console.log("run validation")}
              onPublish={() => console.log("publish mapping")}
              onStepChange={(step) => setCurrentStep(step)}
            />

            {currentStep === 1 ? (
              <Box sx={{ flex: 1, minHeight: 0, p: 2, overflow: "hidden" }}>
                <Box sx={{ display: "flex", gap: 2, height: "100%" }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={2} sx={{ height: "100%" }}>
                      <SourceTargetPanel type="source" />
                      <SourceTargetPanel type="target" />
                    </Stack>
                  </Box>

                  <Box sx={{ width: 300, flexShrink: 0 }}>
                    {/* <AIAgentPanel /> */}
                  </Box>
                </Box>
              </Box>
            ) : (
              <Box sx={{ flex: 1, minHeight: 0, p: 2, overflow: "hidden" }}>
                <Box sx={{ display: "flex", gap: 2, height: "100%" }}>
                  <StepTwoTablePlaceholder />
                  <Box sx={{ width: 300, flexShrink: 0 }}>
                    <MappingQualityPanel
                      mappedCount={9}
                      onRunValidation={() => console.log("run validation")}
                    />
                  </Box>
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      </DataProvider>
    </Box>
  );
}
