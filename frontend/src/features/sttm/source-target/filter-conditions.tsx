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
import { SqlEditor, SQL_EDITOR_PREVIEW_HEIGHT } from "@/components/sql";

export type { RuleLogic, RuleCondition, RuleGroup, RuleNode };

export type GroupByItem = {
  id: string;
  field: string;
};

export type SortDirection = "ASC" | "DESC";

export type OrderByItem = {
  id: string;
  field: string;
  direction: SortDirection;
};

export type QueryBuilderClauses = {
  groups: RuleGroup[];
  whereSql: string;
  groupBy: GroupByItem[];
  orderBy: OrderByItem[];
  groupBySql: string;
  orderBySql: string;
};

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
  onQueryChange?: (payload: QueryBuilderClauses) => void;
  initialGroups?: RuleGroup[];
  initialGroupBy?: string[];
  initialOrderBy?: string[];
  previewSql?: string;
  previewLabel?: string;
  showPreview?: boolean;
}

const DEFAULT_CONTROL_SIZES: Required<FilterControlSizes> = {
  fieldSelectMaxPx: 220,
  operatorWidthPx: 76,
  valueMaxPx: 152,
  groupLogicWidthPx: 88,
};

function serializeRuleNode(node: RuleNode): string {
  if (node.type === "condition") {
    return JSON.stringify({
      type: "condition",
      field: node.field,
      operator: node.operator,
      value: node.value,
      valueMode: node.valueMode ?? "literal",
      valueField: node.valueField ?? "",
      secondaryValue: node.secondaryValue ?? "",
      secondaryValueMode: node.secondaryValueMode ?? "literal",
      secondaryValueField: node.secondaryValueField ?? "",
    });
  }

  return JSON.stringify({
    type: "group",
    logic: node.logic,
    children: node.children.map((child) => serializeRuleNode(child)),
  });
}

function cloneRuleNode(node: RuleNode): RuleNode {
  if (node.type === "condition") {
    return {
      ...node,
    };
  }

  return {
    ...node,
    children: node.children.map((child) => cloneRuleNode(child)) as Array<RuleGroup | RuleCondition>,
  };
}

function cloneRuleGroups(groups: RuleGroup[] | undefined) {
  return (groups ?? []).map((group) => cloneRuleNode(group) as RuleGroup);
}

export function FilterConditions({
  tables,
  controlSizes,
  onChange,
  onQueryChange,
  initialGroups,
  initialGroupBy,
  initialOrderBy,
  previewSql,
  previewLabel = "QUERY PREVIEW",
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

  const normalizeFieldValue = React.useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return "";

      const direct = allFields.find((field) => field.value === trimmed);
      if (direct) return direct.value;

      const unquoted = trimmed.replace(/^"+|"+$/g, "");
      const parts = unquoted.split(".");
      const candidateColumn = (parts[parts.length - 1] || "").replace(/^"+|"+$/g, "");
      if (!candidateColumn) return trimmed;

      const matches = allFields.filter((field) =>
        field.value.toLowerCase().endsWith(`.${candidateColumn.toLowerCase()}`)
      );
      if (matches.length === 1) return matches[0].value;

      return trimmed;
    },
    [allFields]
  );

  const normalizeRuleNode = React.useCallback(
    (node: RuleGroup | RuleCondition): RuleGroup | RuleCondition => {
      if (node.type === "condition") {
        return {
          ...node,
          field: normalizeFieldValue(node.field),
          valueField: node.valueField ? normalizeFieldValue(node.valueField) : node.valueField,
          secondaryValueField: node.secondaryValueField
            ? normalizeFieldValue(node.secondaryValueField)
            : node.secondaryValueField,
        };
      }

      return {
        ...node,
        children: node.children.map((child) => normalizeRuleNode(child)) as Array<
          RuleGroup | RuleCondition
        >,
      };
    },
    [normalizeFieldValue]
  );

  const [rootGroups, _setRootGroups] = useState<RuleGroup[]>(cloneRuleGroups(initialGroups));
  const [activeTab, setActiveTab] = useState<"filters" | "grouping" | "sorting">("filters");
  const [groupByItems, setGroupByItems] = useState<GroupByItem[]>(
    (initialGroupBy ?? []).map((field) => ({
      id: Math.random().toString(36).slice(2, 9),
      field,
    }))
  );
  const [orderByItems, setOrderByItems] = useState<OrderByItem[]>(
    (initialOrderBy ?? []).map((value) => {
      const match = value.trim().match(/^(.*?)(?:\s+(ASC|DESC))?$/i);
      return {
        id: Math.random().toString(36).slice(2, 9),
        field: match?.[1]?.trim() ?? value,
        direction: (match?.[2]?.toUpperCase() as SortDirection | undefined) ?? "ASC",
      };
    })
  );

  React.useEffect(() => {
    if (initialGroups) {
      const normalized = cloneRuleGroups(initialGroups).map(
        (group) => normalizeRuleNode(group) as RuleGroup
      );
      _setRootGroups((prev) => {
        const prevSignature = prev.map((group) => serializeRuleNode(group)).join("|");
        const nextSignature = normalized.map((group) => serializeRuleNode(group)).join("|");
        return prevSignature === nextSignature ? prev : normalized;
      });
    }
  }, [initialGroups, normalizeRuleNode]);

  React.useEffect(() => {
    const next = initialGroupBy ?? [];
    setGroupByItems((prev) => {
      const currentFields = prev.map((item) => item.field);
      if (
        currentFields.length === next.length &&
        currentFields.every((field, index) => field === next[index])
      ) {
        return prev;
      }
      return next.map((field) => ({
        id: Math.random().toString(36).slice(2, 9),
        field: normalizeFieldValue(field),
      }));
    });
  }, [initialGroupBy, normalizeFieldValue]);

  React.useEffect(() => {
    const next = (initialOrderBy ?? []).map((value) => {
      const match = value.trim().match(/^(.*?)(?:\s+(ASC|DESC))?$/i);
      return {
        field: match?.[1]?.trim() ?? value,
        direction: (match?.[2]?.toUpperCase() as SortDirection | undefined) ?? "ASC",
      };
    });
    setOrderByItems((prev) => {
      const same =
        prev.length === next.length &&
        prev.every(
          (item, index) =>
            item.field === next[index]?.field && item.direction === next[index]?.direction
        );
      if (same) return prev;
      return next.map((item) => ({
        id: Math.random().toString(36).slice(2, 9),
        field: normalizeFieldValue(item.field),
        direction: item.direction,
      }));
    });
  }, [initialOrderBy, normalizeFieldValue]);

  const generateSQL = React.useCallback((node: RuleNode, level: number = 0): string => {
    const indent = "  ".repeat(level);
    if (node.type === "condition") {
      const formatLiteral = (raw: string) => {
        const trimmed = raw.trim();
        if (!trimmed) return "''";
        if (
          /^'.*'$/.test(trimmed) ||
          /^-?\d+(\.\d+)?$/.test(trimmed) ||
          /^(true|false|null)$/i.test(trimmed)
        ) {
          return trimmed;
        }
        return `'${trimmed.replace(/'/g, "''")}'`;
      };

      const resolveValue = (
        mode: "literal" | "field" | undefined,
        literal: string | undefined,
        field: string | undefined,
      ) => {
        if (mode === "field" && field) return field;
        return formatLiteral(literal ?? "");
      };

      const operator = node.operator.toUpperCase();
      if (["IS NULL", "IS NOT NULL"].includes(operator)) {
        return `${indent}${node.field} ${operator}`;
      }
      if (["BETWEEN", "NOT BETWEEN"].includes(operator)) {
        return `${indent}${node.field} ${operator} ${resolveValue(
          node.valueMode,
          node.value,
          node.valueField,
        )} AND ${resolveValue(
          node.secondaryValueMode,
          node.secondaryValue,
          node.secondaryValueField,
        )}`;
      }
      if (["IN", "NOT IN"].includes(operator)) {
        const values = node.value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
          .map((item) => formatLiteral(item))
          .join(", ");
        return `${indent}${node.field} ${operator} (${values || "''"})`;
      }
      return `${indent}${node.field} ${operator} ${resolveValue(
        node.valueMode,
        node.value,
        node.valueField,
      )}`;
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

  const onQueryChangeRef = React.useRef(onQueryChange);
  React.useEffect(() => {
    onQueryChangeRef.current = onQueryChange;
  }, [onQueryChange]);

  React.useEffect(() => {
    const sql = rootGroups.map((g) => generateSQL(g, 0)).join("\n\nAND\n\n");
    onChangeRef.current?.(rootGroups, sql);
  }, [rootGroups, generateSQL]);

  const groupBySql = useMemo(
    () => groupByItems.map((item) => item.field).filter(Boolean).join(", "),
    [groupByItems]
  );

  const orderBySql = useMemo(
    () =>
      orderByItems
        .filter((item) => item.field)
        .map((item) => `${item.field} ${item.direction}`)
        .join(", "),
    [orderByItems]
  );

  React.useEffect(() => {
    const whereSql = rootGroups.map((g) => generateSQL(g, 0)).join("\n\nAND\n\n");
    onQueryChangeRef.current?.({
      groups: rootGroups,
      whereSql,
      groupBy: groupByItems,
      orderBy: orderByItems,
      groupBySql,
      orderBySql,
    });
  }, [generateSQL, groupByItems, groupBySql, orderByItems, orderBySql, rootGroups]);

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
          valueMode: "literal",
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

  const handleAddGroupBy = () => {
    setGroupByItems((prev) => [
      ...prev,
      {
        id: generateId(),
        field: allFields[0]?.value || "",
      },
    ]);
  };

  const handleUpdateGroupBy = (id: string, field: string) => {
    setGroupByItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, field } : item))
    );
  };

  const handleDeleteGroupBy = (id: string) => {
    setGroupByItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleAddOrderBy = () => {
    setOrderByItems((prev) => [
      ...prev,
      {
        id: generateId(),
        field: allFields[0]?.value || "",
        direction: "ASC",
      },
    ]);
  };

  const handleUpdateOrderBy = (id: string, updates: Partial<OrderByItem>) => {
    setOrderByItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  const handleDeleteOrderBy = (id: string) => {
    setOrderByItems((prev) => prev.filter((item) => item.id !== id));
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
              { label: "≥", value: ">=" },
              { label: "≤", value: "<=" },
              { label: "LIKE", value: "LIKE" },
              { label: "ILIKE", value: "ILIKE" },
              { label: "IN", value: "IN" },
              { label: "NOT IN", value: "NOT IN" },
              { label: "BETWEEN", value: "BETWEEN" },
              { label: "NOT BETWEEN", value: "NOT BETWEEN" },
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

        {!["IS NULL", "IS NOT NULL"].includes(node.operator.toUpperCase()) ? (
          <>
            <Box sx={{ width: 92, flexShrink: 0 }}>
              <FocusSelect
                options={[
                  { label: "Value", value: "literal" },
                  { label: "Column", value: "field" },
                ]}
                value={node.valueMode ?? "literal"}
                onChange={(val) =>
                  handleUpdateCondition(node.id, {
                    valueMode: val as "literal" | "field",
                    valueField:
                      val === "field" ? node.valueField ?? allFields[0]?.value ?? "" : "",
                  })
                }
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
              {node.valueMode === "field" ? (
                <FocusSelect
                  options={allFields}
                  value={node.valueField ?? ""}
                  placeholder="Select column…"
                  onChange={(val) => handleUpdateCondition(node.id, { valueField: String(val) })}
                  fullWidth
                  sx={{ maxWidth: "100%", ...selectDensitySx }}
                />
              ) : (
                <FocusInput
                  value={node.value}
                  placeholder={["IN", "NOT IN"].includes(node.operator.toUpperCase()) ? "v1, v2, v3" : "value"}
                  onChange={(val) => handleUpdateCondition(node.id, { value: val })}
                  fullWidth
                  sx={inputDensitySx}
                />
              )}
            </Box>

            {["BETWEEN", "NOT BETWEEN"].includes(node.operator.toUpperCase()) ? (
              <>
                <Typography sx={{ fontSize: 12, color: "#64748b", flexShrink: 0 }}>
                  and
                </Typography>
                <Box sx={{ width: 92, flexShrink: 0 }}>
                  <FocusSelect
                    options={[
                      { label: "Value", value: "literal" },
                      { label: "Column", value: "field" },
                    ]}
                    value={node.secondaryValueMode ?? "literal"}
                    onChange={(val) =>
                      handleUpdateCondition(node.id, {
                        secondaryValueMode: val as "literal" | "field",
                        secondaryValueField:
                          val === "field" ? node.secondaryValueField ?? allFields[0]?.value ?? "" : "",
                      })
                    }
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
                  {node.secondaryValueMode === "field" ? (
                    <FocusSelect
                      options={allFields}
                      value={node.secondaryValueField ?? ""}
                      placeholder="Select column…"
                      onChange={(val) =>
                        handleUpdateCondition(node.id, { secondaryValueField: String(val) })
                      }
                      fullWidth
                      sx={{ maxWidth: "100%", ...selectDensitySx }}
                    />
                  ) : (
                    <FocusInput
                      value={node.secondaryValue ?? ""}
                      placeholder="second value"
                      onChange={(val) => handleUpdateCondition(node.id, { secondaryValue: val })}
                      fullWidth
                      sx={inputDensitySx}
                    />
                  )}
                </Box>
              </>
            ) : null}
          </>
        ) : null}

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
  const resolvedPreviewSql = [
    previewSql?.trim() ?? "",
    fullSql ? `WHERE\n${fullSql}` : "",
    groupBySql ? `GROUP BY\n  ${groupBySql}` : "",
    orderBySql ? `ORDER BY\n  ${orderBySql}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const rootCount = rootGroups.length;
  const rootBadgeLabel =
    rootCount === 1 ? "1 root group" : `${rootCount} root groups`;
  const groupingBadgeLabel =
    groupByItems.length === 1 ? "1 grouping" : `${groupByItems.length} groupings`;
  const sortingBadgeLabel =
    orderByItems.length === 1 ? "1 sort" : `${orderByItems.length} sorts`;

  const tabButtonSx = (active: boolean): React.CSSProperties => ({
    border: "none",
    background: active ? "#eff6ff" : "transparent",
    color: active ? "#1d4ed8" : "#64748b",
    borderRadius: 999,
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  });

  return (
    <Box
      className="filter-section"
      sx={{
        backgroundColor: "#ffffff",
        pb: showPreview && tables.length > 0 ? 3 : 0,
      }}
    >
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
            Query builder
          </Typography>
          <span className="canvas-area__badge">
            {activeTab === "filters"
              ? rootBadgeLabel
              : activeTab === "grouping"
                ? groupingBadgeLabel
                : sortingBadgeLabel}
          </span>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <button type="button" style={tabButtonSx(activeTab === "filters")} onClick={() => setActiveTab("filters")}>
              Filters
            </button>
            <button type="button" style={tabButtonSx(activeTab === "grouping")} onClick={() => setActiveTab("grouping")}>
              Grouping
            </button>
            <button type="button" style={tabButtonSx(activeTab === "sorting")} onClick={() => setActiveTab("sorting")}>
              Sorting
            </button>
          </Box>
        </Box>
        <button
          type="button"
          className="canvas-area__add-btn"
          onClick={
            activeTab === "filters"
              ? handleAddRootGroup
              : activeTab === "grouping"
                ? handleAddGroupBy
                : handleAddOrderBy
          }
          disabled={tables.length === 0}
          style={{
            opacity: tables.length === 0 ? 0.5 : 1,
            cursor: tables.length === 0 ? "not-allowed" : "pointer"
          }}
        >
          {activeTab === "filters"
            ? "+ Add Group"
            : activeTab === "grouping"
              ? "+ Add Grouping"
              : "+ Add Sort"}
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
          activeTab === "filters" ? (
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
          ) : activeTab === "grouping" ? (
            <Box sx={{ mt: 2, display: "flex", flexDirection: "column", gap: 1.25 }}>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "52px minmax(0, 320px) auto",
                  gap: 1.25,
                  alignItems: "center",
                  py: 1.25,
                  borderBottom: "1px solid #f1f5f9",
                  color: "#94a3b8",
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                }}
              >
                <Box sx={{ textAlign: "center" }}>#</Box>
                <Box>GROUP BY FIELD</Box>
                <Box />
              </Box>
              {groupByItems.map((item, idx) => (
                <Box
                  key={item.id}
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "52px minmax(0, 320px) auto",
                    gap: 1.25,
                    alignItems: "center",
                    minHeight: 40,
                  }}
                >
                  <Box sx={{ textAlign: "center", color: "#64748b", fontSize: 12, fontWeight: 500 }}>
                    {idx + 1}
                  </Box>
                  <FocusSelect
                    options={allFields}
                    value={item.field}
                    placeholder="Select field…"
                    onChange={(val) => handleUpdateGroupBy(item.id, String(val))}
                    fullWidth
                    sx={{ maxWidth: 320, ...selectDensitySx }}
                  />
                  <FocusButton
                    variant="text"
                    size="small"
                    rounded="full"
                    onClick={() => handleDeleteGroupBy(item.id)}
                    customColor="#ef4444"
                  >
                    ✕
                  </FocusButton>
                </Box>
              ))}
            </Box>
          ) : (
            <Box sx={{ mt: 2, display: "flex", flexDirection: "column", gap: 1.25 }}>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "52px minmax(0, 320px) 120px auto",
                  gap: 1.25,
                  alignItems: "center",
                  py: 1.25,
                  borderBottom: "1px solid #f1f5f9",
                  color: "#94a3b8",
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                }}
              >
                <Box sx={{ textAlign: "center" }}>#</Box>
                <Box>SORT FIELD</Box>
                <Box>DIRECTION</Box>
                <Box />
              </Box>
              {orderByItems.map((item, idx) => (
                <Box
                  key={item.id}
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "52px minmax(0, 320px) 120px auto",
                    gap: 1.25,
                    alignItems: "center",
                    minHeight: 40,
                  }}
                >
                  <Box sx={{ textAlign: "center", color: "#64748b", fontSize: 12, fontWeight: 500 }}>
                    {idx + 1}
                  </Box>
                  <FocusSelect
                    options={allFields}
                    value={item.field}
                    placeholder="Select field…"
                    onChange={(val) => handleUpdateOrderBy(item.id, { field: String(val) })}
                    fullWidth
                    sx={{ maxWidth: 320, ...selectDensitySx }}
                  />
                  <FocusSelect
                    options={[
                      { label: "Ascending", value: "ASC" },
                      { label: "Descending", value: "DESC" },
                    ]}
                    value={item.direction}
                    onChange={(val) => handleUpdateOrderBy(item.id, { direction: val as SortDirection })}
                    fullWidth
                    sx={{ width: 120, ...selectDensitySx }}
                  />
                  <FocusButton
                    variant="text"
                    size="small"
                    rounded="full"
                    onClick={() => handleDeleteOrderBy(item.id)}
                    customColor="#ef4444"
                  >
                    ✕
                  </FocusButton>
                </Box>
              ))}
            </Box>
          )
        )}
      </Box>

      {showPreview && tables.length > 0 && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            borderTop: '1px solid #e2e8f0',
            flexShrink: 0,
          }}
        >
          <SqlEditor
            value={resolvedPreviewSql}
            readOnly
            title={previewLabel}
            emptyText="-- No query clauses defined"
            showCopy
            minHeight={SQL_EDITOR_PREVIEW_HEIGHT}
            maxHeight={SQL_EDITOR_PREVIEW_HEIGHT}
            showLineNumbers={false}
            sx={{ width: '100%' }}
          />
        </Box>
      )}
    </Box>
  );
}
