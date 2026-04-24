// app/sttm/builder/[id]/page.tsx
"use client";

import React, { useEffect } from 'react';
import { Box, Stack } from '@mui/material';
import { useSidebarSlot } from '@/features/sttm/layout/sidebar-slot-context';
import SourceTargetPanel from '@/features/sttm/source-target/source-target-panel';
import SourceTargetDbSelection from '@/features/sttm/source-target/source-target-db-selection';

export default function SourceTargetPage() {
    const { setContent } = useSidebarSlot();

    useEffect(() => {
        setContent(<SourceTargetDbSelection />);
    }, []);

    // return <SourceTargetPanel />;
    return (
        <>
            <div style={{ flex: 1, padding: "16px" }}>
                <div style={{ display: "flex", gap: "16px", height: "90%" }}>
                    <Box sx={{ flex: 1 }}>
                        <Stack direction="row" spacing={2} sx={{ height: '100%' }}>
                            <SourceTargetPanel type="source" />
                            <SourceTargetPanel type="target" />
                            {/* <AddSourcePlaceholder onAdd={(e: { e: any }) => { console.log(e) }} /> */}
                        </Stack>
                    </Box>
                    {/* <Box sx={{ flex: 0.1, minWidth: '300px' }}>
                                    <AIAgentPanel />
                                </Box> */}
                </div>
            </div>

        </>
    )
}