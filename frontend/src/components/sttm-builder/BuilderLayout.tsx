"use client";

import { useEffect, useState } from "react";
import { Box, Stack } from "@mui/material";
import { SttmBuilderProvider } from "@/features/sttm/context/sttm-builder-context";
import AppHeader from "@/features/layout/app-header";
import BuilderContentHeader from "./BuilderContentHeader";
import DataSelectionPanel from "./DataSelectionPanel";
import SourceTargetPanel from "./SourceTargetPanel";
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

      <SttmBuilderProvider>
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
      </SttmBuilderProvider>
    </Box>
  );
}

 