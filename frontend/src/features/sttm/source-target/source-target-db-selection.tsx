"use client";

import { useState } from "react";
import {
  Box,
  Collapse,
  InputBase,
  Typography,
} from "@mui/material";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import StorageRoundedIcon from "@mui/icons-material/StorageRounded";
import SchemaRoundedIcon from "@mui/icons-material/SchemaRounded"; // Updated Icon
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import KeyboardArrowRightRoundedIcon from "@mui/icons-material/KeyboardArrowRightRounded";
import { Database, Schema } from "@/data/source";
import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';

type SectionType = "source" | "target";

export default function SourceTargetDbSelection() {
  const { fullData, selectSchema } = useSttmBuilderContext();
  const [searchText, setSearchText] = useState("");

  const [expandedDbs, setExpandedDbs] = useState<Record<string, boolean>>({
    SRC_DB_1: true,
    TGT_DB_1: true,
  });

  if (!fullData) return <Box sx={{ width: 260, p: 2 }}>Loading...</Box>;

  const toggleDb = (dbId: string) => {
    setExpandedDbs((prev) => ({ ...prev, [dbId]: !prev[dbId] }));
  };

  const matchesSearch = (value: string) =>
    value.toLowerCase().includes(searchText.toLowerCase());

  // Only show DB if name matches OR any schema inside matches
  const shouldShowDatabase = (db: Database) => {
    if (!searchText.trim()) return true;
    if (matchesSearch(db.dbName)) return true;
    return db.schemas.some((schema) => matchesSearch(schema.schemaName));
  };

  const renderSchema = (schema: Schema, dbId: string, type: SectionType) => {
    return (
      <Box key={schema.schemaId}>
        <Box
          onClick={() => selectSchema(type, dbId, schema.schemaId)}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            pl: 3, // Indented under DB
            pr: 1,
            py: 0.5,
            borderRadius: "6px",
            cursor: "pointer",
            // Highlight entire row if schema is selected
            backgroundColor: schema.isSelected ? "#F0F7FF" : "transparent",
            borderLeft: schema.isSelected ? "3px solid #3B82F6" : "3px solid transparent",
            "&:hover": { backgroundColor: "#F8FAFC" },
          }}
        >
          {/* Schema Icon */}
          <SchemaRoundedIcon 
            sx={{ 
              fontSize: 14, 
              color: schema.isSelected ? "#3B82F6" : "#64748B" 
            }} 
          />

          <Typography
            sx={{
              fontSize: 12,
              fontWeight: schema.isSelected ? 700 : 500,
              color: schema.isSelected ? "#1D4ED8" : "#111827",
              lineHeight: 1.2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis"
            }}
          >
            {schema.schemaName}
          </Typography>
        </Box>
      </Box>
    );
  };

  const renderDatabaseSection = (title: string, items: Database[], type: SectionType) => {
    return (
      <Box sx={{ mb: 2.5 }}>
        <Typography
          sx={{
            px: 1.5,
            mb: 1,
            fontSize: 10,
            fontWeight: 700,
            color: "#94A3B8",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {title}
        </Typography>

        {items.filter(shouldShowDatabase).map((db) => {
          const isDbExpanded = expandedDbs[db.dbId];

          return (
            <Box key={db.dbId} sx={{ mb: 0.4 }}>
              <Box
                onClick={() => toggleDb(db.dbId)}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0.5,
                  px: 1,
                  py: 0.6,
                  borderRadius: "6px",
                  cursor: "pointer",
                  backgroundColor: db.isSelected ? "#F8FAFC" : "transparent",
                  "&:hover": { backgroundColor: "#F8FAFC" },
                }}
              >
                {isDbExpanded ? (
                  <KeyboardArrowDownRoundedIcon sx={{ fontSize: 16, color: "#6B7280" }} />
                ) : (
                  <KeyboardArrowRightRoundedIcon sx={{ fontSize: 16, color: "#6B7280" }} />
                )}

                <StorageRoundedIcon 
                  sx={{ 
                    fontSize: 15, 
                    color: db.isSelected ? "#3B82F6" : "#334155" 
                  }} 
                />

                <Typography
                  sx={{
                    fontSize: 12,
                    fontWeight: db.isSelected ? 700 : 500,
                    color: "#111827",
                  }}
                >
                  {db.dbName}
                </Typography>
              </Box>

              <Collapse in={isDbExpanded} timeout="auto" unmountOnExit>
                <Box sx={{ mt: 0.2 }}>
                  {db.schemas
                    .filter((s) => !searchText.trim() || matchesSearch(s.schemaName))
                    .map((sch) => renderSchema(sch, db.dbId, type))}
                </Box>
              </Collapse>
            </Box>
          );
        })}
      </Box>
    );
  };

  return (
    <Box
      sx={{
        width: 260,
        height: "100vh",
        flexShrink: 0,
        borderRight: "1px solid #a8a8a8",
        backgroundColor: "#f9f9f9",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box sx={{ px: 2, py: 2 }}>
        <Typography sx={{ fontSize: 16, fontWeight: 700, color: "#111827", mb: 2 }}>
          Cortex Explorer
        </Typography>

        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 1.5,
            py: 0.8,
            borderRadius: "8px",
            backgroundColor: "#F3F4F6",
            border: "1px solid transparent",
            "&:focus-within": { 
              backgroundColor: "#FFF",
              borderColor: "#3B82F6",
              boxShadow: "0 0 0 2px rgba(59, 130, 246, 0.1)"
            }
          }}
        >
          <SearchRoundedIcon sx={{ fontSize: 18, color: "#9CA3AF" }} />
          <InputBase
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search schemas..."
            sx={{ flex: 1, fontSize: 13, color: "#111827" }}
          />
        </Box>
      </Box>

      <Box sx={{ flex: 1, overflowY: "auto", px: 1 }}>
        {renderDatabaseSection("Source Selection", fullData.sources, "source")}
        {renderDatabaseSection("Target Selection", fullData.targets, "target")}
      </Box>
    </Box>
  );
}
