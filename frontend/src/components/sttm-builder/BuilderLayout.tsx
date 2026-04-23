"use client";

import { useEffect, useState } from "react";
import { Stack, Box, Paper } from "@mui/material";
import AIAgentPanel from "./AIAgentPanel";
import BuilderContentHeader from "./BuilderContentHeader";
import DataSelectionPanel from "./DataSelectionPanel";
import SourceTargetPanel from "./SourceTargetPanel";
import { DataProvider } from "../../contexts/SttmBuilderContext";
import { useRouter } from "next/navigation";
import AppHeader from "../layout/AppHeader";

export default function BuilderLayout() {
    const [mounted, setMounted] = useState(false);
    const router = useRouter();

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return null;

    return (
        <Box className="h-screen overflow-hidden bg-[#F7F8FA]">
            <Paper
                elevation={0}
                className="mx-auto flex min-h-[calc(100vh-32px)] max-w-[1600px] flex-col overflow-hidden rounded-[24px] border border-[#E8ECF4] bg-white"
            >
                <AppHeader />

                <DataProvider>
                    <Box className="flex min-h-0 flex-1 bg-[#F9F9F9]">
                        <DataSelectionPanel />

                        <Box className="flex min-w-0 flex-1 flex-col">

                            <BuilderContentHeader
                                currentStep={1}
                                tableCount={2}
                                mappingCount={0}
                                onProceed={() => router.push("/sttm/mapping")}
                            />

                            {/* <BuilderContentHeader
                                currentStep={2}
                                tableCount={2}
                                mappingCount={9}
                                onRunValidation={() => console.log("run validation")}
                                onPublish={() => console.log("publish mapping")}
                            /> */}

                            <Box className="flex min-h-0 flex-1 gap-4 p-4">
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Stack direction="row" spacing={2} sx={{ height: "100%" }}>
                                        <SourceTargetPanel type="source" />
                                        <SourceTargetPanel type="target" />
                                    </Stack>
                                </Box>

                                <Box sx={{ width: 300, flexShrink: 0 }}>
                                    <AIAgentPanel />
                                </Box>
                            </Box>
                        </Box>
                    </Box>
                </DataProvider>
            </Paper>
        </Box>
    );
}