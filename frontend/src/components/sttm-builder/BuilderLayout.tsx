"use client";

import { useEffect, useState } from "react";
import { Stack, Box } from "@mui/material";
import AIAgentPanel from "./AIAgentPanel";
import BuilderHeader from "./BuilderHeader";
import DataSelectionPanel from "./DataSelectionPanel";
import SourceTargetPanel from "./SourceTargetPanel";
import AddSourcePlaceholder from "./AddSourcePlaceholder";
import { DataProvider } from '../../contexts/DataContext';

export default function BuilderLayout() {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true)
    }, []);

    if (!mounted) return null;

    return (
        <>
            <DataProvider>
                <div style={{ minHeight: "100vh" }}>
                    <BuilderHeader currentStep={1} />
                    <div style={{ display: "flex", minHeight: "calc(100vh-72px)", backgroundColor: '#f9f9f9' }}>
                        <DataSelectionPanel />
                        <div style={{ flex: 1, padding: "16px" }}>
                            <div style={{ display: "flex", gap: "16px", height: "90%" }}>
                                <Box sx={{ flex: 0.9 }}>
                                    <Stack direction="row" spacing={2} sx={{ height: '100%' }}>
                                        <SourceTargetPanel type="source" />
                                        <SourceTargetPanel type="target" />
                                        {/* <AddSourcePlaceholder onAdd={(e: { e: any }) => { console.log(e) }} /> */}
                                    </Stack>
                                </Box>
                                <Box sx={{ flex: 0.1, minWidth: '300px' }}>
                                    <AIAgentPanel />
                                </Box>
                            </div>
                        </div>
                    </div>
                </div>
            </DataProvider>


        </>
        // <>
        //     <DataProvider>
        //         <div style={{ display: "flex", minHeight: "100vh" }}>
        //             <DataSelectionPanel />
        //             <div style={{ flex: 1, padding: "16px" }}>
        //                 <BuilderHeader  currentStep={1}/>
        //                 <div style={{display:"flex", minHeight:"calc(100vh-72px)"}}>
        //                     <Box sx={{ flex: 0.9 }}>
        //                         <Stack direction="row" spacing={2} sx={{ height: '100%' }}>
        //                             <SourceTargetPanel type="target" />
        //                             <SourceTargetPanel type="source" />
        //                             {/* <AddSourcePlaceholder onAdd={(e: { e: any }) => { console.log(e) }} /> */}
        //                         </Stack>
        //                     </Box>
        //                     <Box sx={{ flex: 0.1, minWidth: '300px' }}>
        //                         <AIAgentPanel />
        //                     </Box>
        //                 </div>
        //             </div>
        //         </div>
        //     </DataProvider>

        // </>
    )
}