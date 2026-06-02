"use client";

import { Box, Paper, Typography } from "@mui/material";
import { EditNoteRoundedIcon } from '@/utils/icons';

const mappings = [
  { id: "1", title: "Salesforce Mapping v1", createdOn: "15-04-2024 09:22" },
  { id: "2", title: "CRM Migration Mapping v2", createdOn: "10-04-2024 14:05" },
  { id: "3", title: "API Mapping v3", createdOn: "07-04-2024 11:30" },
  { id: "4", title: "API Mapping v4", createdOn: "01-04-2024 10:44" },
];

export default function RecentMappingsPanel() {
  return (
    <Paper
      elevation={0}
      className="rounded-2xl border border-[#EEF2F7] bg-white p-5"
    >
      <Typography className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">
        Recent Mappings
      </Typography>

      <Box className="mt-4 flex flex-col">
        {mappings.map((item, index) => (
          <Box
            key={item.id}
            className={`flex items-start gap-3 py-3 ${
              index < mappings.length - 1 ? "border-b border-[#F1F5F9]" : ""
            }`}
          >
            <Box className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center text-[#374151]">
              <EditNoteRoundedIcon sx={{ fontSize: 22 }} />
            </Box>

            <Box className="min-w-0">
              <Typography className="text-[13px] font-semibold text-[#111827]">
                {item.title}
              </Typography>
              <Typography className="mt-0.5 text-[11px] text-[#6B7280]">
                Created on {item.createdOn}
              </Typography>
            </Box>
          </Box>
        ))}
      </Box>
    </Paper>
  );
}
