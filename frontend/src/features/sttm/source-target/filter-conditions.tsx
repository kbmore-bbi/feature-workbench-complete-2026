"use client";

import React, { useMemo, useState } from "react";
import { Box, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import type {
  TableMeta,
  RuleLogic,
  RuleCondition,
  RuleGroup,
  RuleNode,
} from "@/features/sttm/types/sttm.types";
import { FocusButton } from "@/components/ui/focus-button";
import { FocusSelect } from "@/components/ui/focus-select";
import { FocusInput } from "@/components/ui/focus-input";

export type { RuleLogic, RuleCondition, RuleGroup, RuleNode } from "@/features/sttm/types/sttm.types";

export type FilterControlSizes = {
  /** Max width (px) for the field/column select on condition rows */
  fieldSelectMaxPx?: number;
  operatorWidthPx?: number;
  valueMaxPx?: number;
  groupLogicWidthPx?: number;
};

interface FilterConditionsProps {
  tables: TableMeta[];
  /** Optional pixel widths; defaults are compact to match UX (narrower than full flex). */
  controlSizes?: FilterControlSizes;
  onChange?: (groups: RuleGroup[], sql: string) => void;
  initialGroups?: RuleGroup[];
  showPreview?: boolean;
}

const DEFAULT_CONTROL_SIZES: Required<FilterControlSizes> = {
  fieldSelectMaxPx: 220,
  operatorWidthPx: 76,
  valueMaxPx: 152,
  groupLogicWidthPx: 88,
};

export function FilterConditions({
  tables,
  controlSizes,
  onChange,
  initialGroups,
  showPreview = true,
}: FilterConditionsProps) {
  const cw = { ...DEFAULT_CONTROL_SIZES, ...controlSizes };

  const selectDensitySx: SxProps<Theme> = {
    "& .MuiOutlinedInput-root": { fontSize: 12 },
    "& .MuiSelect-select": {
      py: "6px !important",
      minHeight: "unset !important",
    },
  };

  const inputDensitySx: SxProps<Theme> = {
    "& .MuiInputBase-input": {
      py: "6px !important",
      fontSize: 12,
      lineHeight: 1.35,
    },
  };
  const allFields = useMemo(() => {
    return tables.flatMap((t) => {
      const schema = t.schema ?? "";
      const name = t.name ?? "";
      const cols = t.columns ?? [];
      return cols.map((c) => {
        const colName = c.name ?? "";
        const full = `${schema}.${name}.${colName}`.replace(/\.+/g, ".");
        return { value: full, label: full };
      });
    });
  }, [tables]);

  const cloneGroups = (groups: RuleGroup[] | undefined) =>
    groups?.length ? structuredClone(groups) : [];

  const serializedInitialRef = React.useRef<string | null>(null);

  const [rootGroups, _setRootGroups] = useState<RuleGroup[]>(() =>
    cloneGroups(initialGroups)
  );

  React.useEffect(() => {
    if (initialGroups === undefined) return;
    const serialized = JSON.stringify(initialGroups);
    if (serialized === serializedInitialRef.current) return;
    serializedInitialRef.current = serialized;
    _setRootGroups(cloneGroups(initialGroups));
  }, [initialGroups]);

  const generateSQL = React.useCallback((node: RuleNode, level: number = 0): string => {
    const indent = "  ".repeat(level);
    if (node.type === "condition") {
      const valStr = ["IS NULL", "IS NOT NULL"].includes(node.operator)
        ? ""
        : ` '${node.value}'`;
      return `${indent}${node.field} ${node.operator}${valStr}`;
    }

    if (node.children.length === 0) return `${indent}-- (Empty Group)`;

    const logicMap = { AND: " AND ", OR: " OR ", NOT: " AND NOT " };
    const joinStr = `\n${indent}${logicMap[node.logic]}\n`;
    const childrenSql = node.children
      .map((c) => generateSQL(c, level + 1))
      .join(joinStr);

    const logicName =
      node.logic === "AND" ? "All" : node.logic === "OR" ? "Any" : "None";
    const header = `${indent}-- Group (${logicName} conditions)\n`;

    return `${header}${indent}(\n${childrenSql}\n${indent})`;
  }, []);

  const onChangeRef = React.useRef(onChange);
  React.useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  React.useEffect(() => {
    const sql = rootGroups.map((g) => generateSQL(g, 0)).join("\n\nAND\n\n");
    onChangeRef.current?.(rootGroups, sql);
  }, [rootGroups, generateSQL]);

  const setRootGroups = (valOrUpdater: React.SetStateAction<RuleGroup[]>) => {
    _setRootGroups(valOrUpdater);
  };

  const generateId = () => Math.random().toString(36).substring(2, 9);

  const updateNode = (
    nodes: RuleNode[],
    id: string,
    updater: (node: RuleNode) => RuleNode
  ): RuleNode[] => {
    return nodes.map((node) => {
      if (node.id === id) {
        return updater(node);
      }
      if (node.type === "group") {
        return {
          ...node,
          children: updateNode(node.children, id, updater),
        };
      }
      return node;
    });
  };

  const removeNode = (nodes: RuleNode[], id: string): RuleNode[] => {
    return nodes
      .filter((n) => n.id !== id)
      .map((node) => {
        if (node.type === "group") {
          return {
            ...node,
            children: removeNode(node.children, id),
          };
        }
        return node;
      });
  };

  const addNodeToGroup = (
    nodes: RuleNode[],
    groupId: string,
    newNode: RuleNode
  ): RuleNode[] => {
    return nodes.map((node) => {
      if (node.id === groupId && node.type === "group") {
        return {
          ...node,
          children: [...node.children, newNode],
        };
      }
      if (node.type === "group") {
        return {
          ...node,
          children: addNodeToGroup(node.children, groupId, newNode),
        };
      }
      return node;
    });
  };

  const handleUpdateLogic = (id: string, logic: RuleLogic) => {
    setRootGroups(
      (prev) =>
        updateNode(prev, id, (n) => ({ ...n, logic } as RuleGroup)) as RuleGroup[]
    );
  };

  const handleUpdateCondition = (
    id: string,
    updates: Partial<RuleCondition>
  ) => {
    setRootGroups(
      (prev) =>
        updateNode(prev, id, (n) => ({ ...n, ...updates } as RuleCondition)) as RuleGroup[]
    );
  };

  const handleDelete = (id: string) => {
    setRootGroups((prev) => removeNode(prev, id) as RuleGroup[]);
  };

  const handleAddCondition = (groupId: string) => {
    setRootGroups(
      (prev) =>
        addNodeToGroup(prev, groupId, {
          id: generateId(),
          type: "condition",
          field: allFields[0]?.value || "",
          operator: "=",
          value: "",
        }) as RuleGroup[]
    );
  };

  const handleAddGroup = (groupId: string) => {
    setRootGroups(
      (prev) =>
        addNodeToGroup(prev, groupId, {
          id: generateId(),
          type: "group",
          logic: "AND",
          children: [],
        }) as RuleGroup[]
    );
  };

  const handleAddRootGroup = () => {
    setRootGroups((prev) => [
      ...prev,
      {
        id: generateId(),
        type: "group",
        logic: "AND",
        children: [],
      },
    ]);
  };

  const renderNode = (node: RuleNode, prefix: string) => {
    if (node.type === "group") {
      return (
        <Box key={node.id} sx={{ display: "flex", flexDirection: "column" }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.25,
              minHeight: 40,
              py: 0.5,
              borderRadius: 1,
              "&:hover .filter-row-actions, &:focus-within .filter-row-actions": {
                opacity: 1,
                pointerEvents: "auto",
              },
            }}
          >
            <Box sx={{ width: 52, textAlign: "center", color: "#64748b", fontSize: 12, fontWeight: 500 }}>
              {prefix}
            </Box>

            <Box sx={{ width: 12, color: "#cbd5e1", fontSize: 12 }}>▼</Box>

            <Box sx={{ width: cw.groupLogicWidthPx, flexShrink: 0 }}>
              <FocusSelect
                options={[
                  { label: "All", value: "AND" },
                  { label: "Any", value: "OR" },
                  { label: "None", value: "NOT" },
                ]}
                value={node.logic}
                placeholder="All"
                onChange={(val) => handleUpdateLogic(node.id, val as RuleLogic)}
                fullWidth
                sx={{ width: "100%", ...selectDensitySx }}
              />
            </Box>

            <Typography sx={{ fontSize: 12, color: "#64748b" }}>
              of the conditions in this branch must match
            </Typography>

            <Box
              className="filter-row-actions"
              sx={{
                ml: "auto",
                display: "flex",
                alignItems: "center",
                gap: 1,
                opacity: 0,
                pointerEvents: "none",
                transition: "opacity 0.18s ease",
              }}
            >
              <FocusButton
                variant="outlined"
                size="small"
                rounded="full"
                onClick={() => handleAddCondition(node.id)}
                customBorderColor="#e5e7eb"
                customBackgroundColor="#ffffff"
                customHoverBackgroundColor="#f8fafc"
                customColor="#374151"
              >
                + Condition
              </FocusButton>
              <FocusButton
                variant="outlined"
                size="small"
                rounded="full"
                onClick={() => handleAddGroup(node.id)}
                customBorderColor="#bfdbfe"
                customBackgroundColor="#eff6ff"
                customHoverBackgroundColor="#dbeafe"
                customColor="#1d4ed8"
              >
                + Sub-group
              </FocusButton>
              <FocusButton
                variant="text"
                size="small"
                rounded="full"
                onClick={() => handleDelete(node.id)}
                customColor="#ef4444"
              >
                ✕
              </FocusButton>
            </Box>
          </Box>

          <Box
            sx={{
              ml: 6.5,
              borderLeft: "1px solid #e2e8f0",
              pl: 3,
              mt: 1.25,
              display: "flex",
              flexDirection: "column",
              gap: 1.25,
            }}
          >
            {node.children.map((child, idx) =>
              renderNode(child, `${prefix}.${idx + 1}`)
            )}
          </Box>
        </Box>
      );
    }

    return (
      <Box
        key={node.id}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          minHeight: 40,
          borderRadius: 1,
          "&:hover .filter-row-actions, &:focus-within .filter-row-actions": {
            opacity: 1,
            pointerEvents: "auto",
          },
        }}
      >
        <Box sx={{ width: 52, textAlign: "center", color: "#64748b", fontSize: 12, fontWeight: 500 }}>
          {prefix}
        </Box>

        <Box
          sx={{
            flex: "0 1 auto",
            maxWidth: cw.fieldSelectMaxPx,
            width: "100%",
            minWidth: 0,
          }}
        >
          <FocusSelect
            options={allFields}
            value={node.field}
            placeholder="Select field…"
            onChange={(val) => handleUpdateCondition(node.id, { field: String(val) })}
            fullWidth
            sx={{ maxWidth: "100%", ...selectDensitySx }}
          />
        </Box>

        <Box sx={{ width: cw.operatorWidthPx, flexShrink: 0 }}>
          <FocusSelect
            options={[
              { label: "=", value: "=" },
              { label: "≠", value: "!=" },
              { label: ">", value: ">" },
              { label: "<", value: "<" },
              { label: "IS NULL", value: "IS NULL" },
              { label: "IS NOT NULL", value: "IS NOT NULL" },
            ]}
            value={node.operator}
            placeholder="="
            onChange={(val) => handleUpdateCondition(node.id, { operator: String(val) })}
            fullWidth
            sx={{ width: "100%", ...selectDensitySx }}
          />
        </Box>

        <Box
          sx={{
            width: "100%",
            maxWidth: cw.valueMaxPx,
            flexShrink: 0,
          }}
        >
          <FocusInput
            value={node.value}
            placeholder="value"
            onChange={(val) => handleUpdateCondition(node.id, { value: val })}
            fullWidth
            sx={inputDensitySx}
          />
        </Box>

        <Box
          className="filter-row-actions"
          sx={{
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
            opacity: 0,
            pointerEvents: "none",
            transition: "opacity 0.18s ease",
          }}
        >
          <FocusButton
            variant="text"
            size="small"
            rounded="full"
            onClick={() => handleDelete(node.id)}
            customColor="#ef4444"
          >
            ✕
          </FocusButton>
        </Box>
      </Box>
    );
  };


  const fullSql = rootGroups.map((g) => generateSQL(g, 0)).join("\n\nAND\n\n");

  const rootCount = rootGroups.length;
  const rootBadgeLabel =
    rootCount === 1 ? "1 root group" : `${rootCount} root groups`;

  return (
    <Box className="filter-section" sx={{ backgroundColor: "#ffffff" }}>
      <Box
        className="filter-header"
        sx={{
          px: 3,
          py: 2,
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexWrap: "wrap",
          }}
        >
          <Typography
            sx={{
              fontSize: 15,
              fontWeight: 800,
              color: "#0f172a",
              letterSpacing: "-0.02em",
            }}
          >
            Filter Conditions
          </Typography>
          <Typography sx={{ fontSize: 12, color: "#64748b" }}>
            Hierarchical WHERE clause builder
          </Typography>
          <span className="canvas-area__badge">{rootBadgeLabel}</span>
        </Box>
        <button
          type="button"
          className="canvas-area__add-btn"
          onClick={handleAddRootGroup}
          disabled={tables.length === 0}
          style={{
            opacity: tables.length === 0 ? 0.5 : 1,
            cursor: tables.length === 0 ? "not-allowed" : "pointer"
          }}
        >
          + Add Group
        </button>
      </Box>

      <Box className="filter-body" sx={{ px: 3, pb: 3 }}>
        {tables.length === 0 ? (
          <div className="canvas-area__empty" aria-hidden style={{ marginTop: 24, marginBottom: 8 }}>
            <div className="canvas-area__empty-inner">
              Select one or more tables from Source selection. They will appear
              here so you can define filter conditions.
            </div>
          </div>
        ) : (
          <>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                py: 1.25,
                borderBottom: "1px solid #f1f5f9",
                color: "#94a3b8",
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: "0.08em",
              }}
            >
              <Box sx={{ width: 52, textAlign: "center" }}>#</Box>
              <Box sx={{ flex: 1 }}>CONDITION / GROUP</Box>
            </Box>

            <Box sx={{ mt: 2, display: "flex", flexDirection: "column", gap: 1.25 }}>
              {rootGroups.map((group, idx) => renderNode(group, `${idx + 1}`))}
            </Box>
          </>
        )}
      </Box>

      {showPreview && tables.length > 0 && (
        <Box className="filter-preview">
          <div className="filter-preview__title">WHERE CLAUSE PREVIEW</div>
          <pre className="filter-preview__code">
            {fullSql || "-- No conditions defined"}
          </pre>
        </Box>
      )}
    </Box>
  );
}
