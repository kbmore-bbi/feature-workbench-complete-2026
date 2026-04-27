"use client";

import React from "react";
import { Box, Typography, Stack } from "@mui/material";

export default function Footer() {
    return (
        <Box sx={{ position: 'absolute', bottom: 24, left: 32, right: 32, display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #eee', pt: 2 }}>
            <Typography variant="caption" sx={{ color: '#999' }}>© 2026 Focus Financial Partner. ALL RIGHTS RESERVED.</Typography>
            <Stack direction="row" spacing={4}>
                {['PRIVACY POLICY', 'TERMS OF SERVICE', 'CONTACT'].map(text => (
                    <Typography key={text} variant="caption" sx={{ color: '#999', cursor: 'pointer' }}>{text}</Typography>
                ))}
            </Stack>
        </Box>
    );
}