"use client";
import { AiaBox } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import React, { useMemo, useState } from "react";

import type { SxProps, Theme } from "@mui/material/styles";
import type {
  JoinConfig,
  TableMeta,
  RuleLogic,
  RuleCondition,
  RuleGroup,
  RuleNode,
} from "@/features/sttm/types/sttm.types";
import { AiaButton } from "@/components/ui/aia-button";
import { AiaChip } from "@/components/ui/aia-chip";
import { textStyleCssVars } from "@/config/typography-tokens";
import { AddIcon, FilterListRoundedIcon } from "@/utils/icons";
import { AiaSelect } from "@/components/ui/aia-select";
import { AiaAutocomplete } from "@/components/ui/aia-auto-complete";
import { AiaInput } from "@/components/ui/aia-input";
import { SqlEditor } from "@/components/sql";
import { TOUR_TARGETS } from "@/features/tour/constants/tour-targets";
import { getApiErrorMessage } from "@/api/axiosInstance";
import { dbService } from "@/services/dbService";

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
  expandedPreviewSql?: string;
  expandedReferenceReplacements?: Record<string, string>;
  relationships?: JoinConfig[];
  drivingTableId?: string | null;
  previewLabel?: string;
  showPreview?: boolean;
}

const DEFAULT_CONTROL_SIZES: Required<FilterControlSizes> = {
  fieldSelectMaxPx: 220,
  operatorWidthPx: 76,
  valueMaxPx: 152,
  groupLogicWidthPx: 88,
};
const SOURCE_QUERY_PREVIEW_HEIGHT = 420;

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
  expandedPreviewSql,
  expandedReferenceReplacements,
  relationships = [],
  drivingTableId,
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

  const fieldAutocompleteSx: SxProps<Theme> = {
    ...selectDensitySx,
    "& .MuiInputBase-input, & .MuiAutocomplete-input": {
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
        return {
          value: full,
          label: colName,
          group: name,
        };
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

      return "";
    },
    [allFields]
  );

  const toFieldValue = React.useCallback(
    (val: string | string[]) =>
      normalizeFieldValue(Array.isArray(val) ? val[0] ?? "" : String(val)),
    [normalizeFieldValue]
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
  const [previewMode, setPreviewMode] = useState<"runtime" | "expanded">("runtime");
  const [previewOverrides, setPreviewOverrides] = useState<Partial<Record<"runtime" | "expanded", string>>>({});
  const [isValidatingPreview, setIsValidatingPreview] = useState(false);
  const [previewValidation, setPreviewValidation] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [validatedPreview, setValidatedPreview] = useState<{
    columns: Array<{ name: string; dataType: string }>;
    rows: Array<Record<string, unknown>>;
  } | null>(null);
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
        <AiaBox key={node.id} sx={{ display: "flex", flexDirection: "column" }}>
          <AiaBox
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.25,
              width: "100%",
              minHeight: 40,
              py: 0.5,
              borderRadius: 1,
              "&:hover .filter-row-actions, &:focus-within .filter-row-actions": {
                opacity: 1,
                pointerEvents: "auto",
              },
            }}
          >
            <AiaBox sx={{ width: 52, textAlign: "center", color: "#64748b", fontSize: 12, fontWeight: 500 }}>
              {prefix}
            </AiaBox>

            <AiaBox sx={{ width: 12, color: "#cbd5e1", fontSize: 12 }}>▼</AiaBox>

            <AiaBox sx={{ width: cw.groupLogicWidthPx, flexShrink: 0 }}>
              <AiaSelect
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
            </AiaBox>

            <AiaText sx={{ fontSize: 12, color: "#64748b", flexShrink: 0 }}>
              of the conditions in this branch must match
            </AiaText>

            <AiaBox
              className="filter-row-actions"
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.75,
                flexShrink: 0,
                ml: "auto",
                opacity: 0,
                pointerEvents: "none",
                transition: "opacity 0.18s ease",
              }}
            >
              <AiaButton
                variant="outlined"
                size="small"
                onClick={() => handleAddCondition(node.id)}
                sx={{ minWidth: 0, boxShadow: "none" }}
                customBorderColor="var(--aia-button-color)"
                customColor="var(--aia-button-color)"
                customHoverBackgroundColor="color-mix(in srgb, var(--aia-button-color) 6%, transparent)"
              >
                + Condition
              </AiaButton>
              <AiaButton
                variant="outlined"
                size="small"
                onClick={() => handleAddGroup(node.id)}
                sx={{ minWidth: 0, boxShadow: "none" }}
                customBorderColor="var(--aia-button-color)"
                customColor="var(--aia-button-color)"
                customHoverBackgroundColor="color-mix(in srgb, var(--aia-button-color) 6%, transparent)"
              >
                + Sub-group
              </AiaButton>
              <AiaButton
                variant="outlined"
                size="small"
                onClick={() => handleDelete(node.id)}
                sx={{
                  minWidth: 28,
                  width: 28,
                  height: 28,
                  p: 0,
                  fontSize: 14,
                  lineHeight: 1,
                  boxShadow: "none",
                }}
                customBorderColor="var(--aia-button-color)"
                customColor="var(--aia-button-color)"
                customHoverBackgroundColor="color-mix(in srgb, var(--aia-button-color) 6%, transparent)"
              >
                ✕
              </AiaButton>
            </AiaBox>
          </AiaBox>

          <AiaBox
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
          </AiaBox>
        </AiaBox>
      );
    }

    return (
      <AiaBox
        key={node.id}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          width: "100%",
          minHeight: 40,
          borderRadius: 1,
          "&:hover .filter-row-actions, &:focus-within .filter-row-actions": {
            opacity: 1,
            pointerEvents: "auto",
          },
        }}
      >
        <AiaBox sx={{ width: 52, textAlign: "center", color: "#64748b", fontSize: 12, fontWeight: 500 }}>
          {prefix}
        </AiaBox>

        <AiaBox
          sx={{
            flex: "0 1 auto",
            maxWidth: cw.fieldSelectMaxPx,
            width: "100%",
            minWidth: 0,
          }}
        >
          <AiaAutocomplete
            hideLabel
            freeSolo
            options={allFields}
            groupBy={(option) => option.group ?? ""}
            value={node.field}
            placeholder="Search field…"
            onChange={(val) => handleUpdateCondition(node.id, { field: toFieldValue(val) })}
            fullWidth
            sx={{ maxWidth: "100%", ...fieldAutocompleteSx }}
          />
        </AiaBox>

        <AiaBox sx={{ width: cw.operatorWidthPx, flexShrink: 0 }}>
          <AiaSelect
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
        </AiaBox>

        {!["IS NULL", "IS NOT NULL"].includes(node.operator.toUpperCase()) ? (
          <>
            <AiaBox sx={{ width: 92, flexShrink: 0 }}>
              <AiaSelect
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
            </AiaBox>

            <AiaBox
              sx={{
                width: "100%",
                maxWidth: cw.valueMaxPx,
                flexShrink: 0,
              }}
            >
              {node.valueMode === "field" ? (
                <AiaAutocomplete
                  hideLabel
                  freeSolo
                  options={allFields}
                  groupBy={(option) => option.group ?? ""}
                  value={node.valueField ?? ""}
                  placeholder="Search column…"
                  onChange={(val) =>
                    handleUpdateCondition(node.id, { valueField: toFieldValue(val) })
                  }
                  fullWidth
                  sx={{ maxWidth: "100%", ...fieldAutocompleteSx }}
                />
              ) : (
                <AiaInput
                  value={node.value}
                  placeholder={["IN", "NOT IN"].includes(node.operator.toUpperCase()) ? "v1, v2, v3" : "value"}
                  onChange={(val) => handleUpdateCondition(node.id, { value: val })}
                  fullWidth
                  sx={inputDensitySx}
                />
              )}
            </AiaBox>

            {["BETWEEN", "NOT BETWEEN"].includes(node.operator.toUpperCase()) ? (
              <>
                <AiaText sx={{ fontSize: 12, color: "#64748b", flexShrink: 0 }}>
                  and
                </AiaText>
                <AiaBox sx={{ width: 92, flexShrink: 0 }}>
                  <AiaSelect
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
                </AiaBox>
                <AiaBox
                  sx={{
                    width: "100%",
                    maxWidth: cw.valueMaxPx,
                    flexShrink: 0,
                  }}
                >
                  {node.secondaryValueMode === "field" ? (
                    <AiaAutocomplete
                      hideLabel
                      freeSolo
                      options={allFields}
                      groupBy={(option) => option.group ?? ""}
                      value={node.secondaryValueField ?? ""}
                      placeholder="Search column…"
                      onChange={(val) =>
                        handleUpdateCondition(node.id, {
                          secondaryValueField: toFieldValue(val),
                        })
                      }
                      fullWidth
                      sx={{ maxWidth: "100%", ...fieldAutocompleteSx }}
                    />
                  ) : (
                    <AiaInput
                      value={node.secondaryValue ?? ""}
                      placeholder="second value"
                      onChange={(val) => handleUpdateCondition(node.id, { secondaryValue: val })}
                      fullWidth
                      sx={inputDensitySx}
                    />
                  )}
                </AiaBox>
              </>
            ) : null}
          </>
        ) : null}

        <AiaBox
          className="filter-row-actions"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.75,
            flexShrink: 0,
            ml: "auto",
            opacity: 0,
            pointerEvents: "none",
            transition: "opacity 0.18s ease",
          }}
        >
          <AiaButton
            variant="outlined"
            size="small"
            onClick={() => handleDelete(node.id)}
            sx={{
              minWidth: 28,
              width: 28,
              height: 28,
              p: 0,
              fontSize: 14,
              lineHeight: 1,
              boxShadow: "none",
            }}
            customBorderColor="var(--aia-button-color)"
            customColor="var(--aia-button-color)"
            customHoverBackgroundColor="color-mix(in srgb, var(--aia-button-color) 6%, transparent)"
          >
            ✕
          </AiaButton>
        </AiaBox>
      </AiaBox>
    );
  };

  const fullSql = rootGroups.map((g) => generateSQL(g, 0)).join("\n\nAND\n\n");
  const selectedPreviewSql = previewMode === "expanded" && expandedPreviewSql
    ? expandedPreviewSql
    : previewSql;
  let resolvedPreviewSql = [
    selectedPreviewSql?.trim() ?? "",
    fullSql ? `WHERE\n${fullSql}` : "",
    groupBySql ? `GROUP BY\n  ${groupBySql}` : "",
    orderBySql ? `ORDER BY\n  ${orderBySql}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  if (previewMode === "expanded") {
    for (const [reference, alias] of Object.entries(expandedReferenceReplacements ?? {})) {
      resolvedPreviewSql = resolvedPreviewSql.split(reference).join(alias);
    }
  }
  const editablePreviewSql = previewOverrides[previewMode] ?? resolvedPreviewSql;
  const hasPreviewOverride = previewOverrides[previewMode] !== undefined;

  const handlePreviewSqlChange = (nextSql: string) => {
    setPreviewOverrides((current) => ({ ...current, [previewMode]: nextSql }));
    setPreviewValidation(null);
    setValidatedPreview(null);
  };

  const handleResetPreviewSql = () => {
    setPreviewOverrides((current) => {
      const next = { ...current };
      delete next[previewMode];
      return next;
    });
    setPreviewValidation(null);
    setValidatedPreview(null);
  };

  const handleValidatePreviewSql = async () => {
    if (!editablePreviewSql.trim()) {
      setPreviewValidation({ type: "error", message: "Enter SQL before validating the query." });
      return;
    }

    const tableById = new Map(tables.map((table) => [table.id, table]));
    const toTableRef = (table: TableMeta | undefined) => ({
      database: table?.database ?? "",
      schema: table?.schema ?? "",
      table: table?.name ?? "",
    });
    // DERIVED.DERIVED is a canvas identity, not a physical Snowflake object.
    // Derived SQL is already represented by its physical view or inline CTE.
    const isSyntheticDerived = (table: TableMeta) =>
      table.tag === "Derived" ||
      (table.database ?? "").toUpperCase() === "DERIVED";
    const sourceTables = tables
      .filter((table) => !isSyntheticDerived(table))
      .map((table) => toTableRef(table))
      .filter((table) => table.database && table.schema && table.table);
    const drivingTableMeta = drivingTableId ? tableById.get(drivingTableId) : undefined;
    const drivingTable = toTableRef(
      drivingTableMeta && !isSyntheticDerived(drivingTableMeta) ? drivingTableMeta : undefined,
    );

    try {
      setIsValidatingPreview(true);
      setPreviewValidation(null);
      setValidatedPreview(null);
      const result = await dbService.validateDerivedSource({
        derived_source_name: "__selection_query_validation__",
        sql_text: editablePreviewSql,
        source_tables: sourceTables,
        driving_table: drivingTable.database && drivingTable.schema && drivingTable.table
          ? drivingTable
          : null,
        relationships: relationships
          .map((relationship) => ({
            id: relationship.id,
            left_table: toTableRef(tableById.get(relationship.leftTableId)),
            right_table: toTableRef(tableById.get(relationship.rightTableId)),
            join_type: relationship.joinType ?? "INNER",
            constraint_name: relationship.constraintName ?? null,
            source: relationship.source ?? "USER_DEFINED",
            locked: relationship.locked ?? false,
            conditions: (relationship.conditions ?? [])
              .filter((condition) => condition.leftColumn && condition.rightColumn)
              .map((condition) => ({
                left_column: condition.leftColumn as string,
                right_column: condition.rightColumn as string,
                operator: condition.operator ?? "=",
              })),
          }))
          .filter(
            (relationship) =>
              relationship.left_table.database &&
              relationship.left_table.schema &&
              relationship.left_table.table &&
              relationship.right_table.database &&
              relationship.right_table.schema &&
              relationship.right_table.table,
          ),
        filters: rootGroups,
      });
      if (!result.valid) {
        setPreviewValidation({
          type: "error",
          message: result.message || "Snowflake did not accept the query.",
        });
        return;
      }
      const rowCount = result.preview_rows?.length ?? 0;
      setValidatedPreview({
        columns: (result.preview_columns ?? []).map((column) => ({
          name: column.name,
          dataType: column.data_type,
        })),
        rows: (result.preview_rows ?? []).map((row) => row.values),
      });
      setPreviewValidation({
        type: "success",
        message: result.message || `SQL is valid. The preview query returned ${rowCount} sample row${rowCount === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      setPreviewValidation({
        type: "error",
        message: getApiErrorMessage(error, "Unable to validate the query in Snowflake."),
      });
    } finally {
      setIsValidatingPreview(false);
    }
  };

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
    <AiaBox
      className="filter-section"
      sx={{
        backgroundColor: "#ffffff",
        minHeight: 420,
        display: "flex",
        flexDirection: "column",
        pb: 0,
      }}
    >
      <AiaBox
        className="filter-header"
        sx={{
          px: 3,
          minHeight: "var(--aia-workspace-section-header-min-height)",
          borderBottom: "1px solid #e5e7eb",
          flexShrink: 0,
          gap: 2,
          overflow: "visible",
        }}
      >
        <AiaBox
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.25,
            flexWrap: "wrap",
            flex: 1,
            minWidth: 0,
            overflow: "visible",
          }}
        >
          <FilterListRoundedIcon
            sx={{
              fontSize: "calc(var(--aia-card-title-font-size) + 2px)",
              color: "var(--aia-card-title-color)",
              flexShrink: 0,
            }}
            aria-hidden
          />
          <AiaText
            sx={{
              ...textStyleCssVars("cardTitle"),
              textTransform: "capitalize",
              letterSpacing: "-0.01em",
            }}
          >
            Filter conditions
          </AiaText>
          <AiaText sx={{ fontSize: 12, color: "#64748b" }}>
            Query builder
          </AiaText>
          <AiaChip
            size="small"
            color="primary"
            label={
              activeTab === "filters"
                ? rootBadgeLabel
                : activeTab === "grouping"
                  ? groupingBadgeLabel
                  : sortingBadgeLabel
            }
          />
          <AiaBox sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <button
              type="button"
              style={tabButtonSx(activeTab === "filters")}
              onClick={() => setActiveTab("filters")}
            >
              Filters
            </button>
            <button
              type="button"
              style={tabButtonSx(activeTab === "grouping")}
              onClick={() => setActiveTab("grouping")}
            >
              Grouping
            </button>
            <button
              type="button"
              style={tabButtonSx(activeTab === "sorting")}
              onClick={() => setActiveTab("sorting")}
            >
              Sorting
            </button>
          </AiaBox>
        </AiaBox>
        <AiaButton
          data-tour={TOUR_TARGETS.sttmAddGroup}
          size="small"
          variant="outlined"
          startIcon={<AddIcon sx={{ fontSize: 18 }} />}
          onClick={
            activeTab === "filters"
              ? handleAddRootGroup
              : activeTab === "grouping"
                ? handleAddGroupBy
                : handleAddOrderBy
          }
          disabled={tables.length === 0}
          sx={{ minWidth: 0, boxShadow: "none", flexShrink: 0 }}
          customBorderColor="var(--aia-state-success-color)"
          customColor="var(--aia-state-success-color)"
          customHoverBackgroundColor="var(--aia-state-success-hover-bg)"
        >
          {activeTab === "filters"
            ? "Add Group"
            : activeTab === "grouping"
              ? "Add Grouping"
              : "Add Sort"}
        </AiaButton>
      </AiaBox>

      <AiaBox
        className="filter-body"
        sx={{
          px: 3,
          pb: showPreview && tables.length > 0 ? 0 : 3,
          flex: 1,
          minHeight: 320,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {tables.length === 0 ? (
          <div className="filter-empty-state" aria-hidden>
            <div className="canvas-area__empty-inner">
              Select one or more tables from Source selection. They will appear
              here so you can define filter conditions.
            </div>
          </div>
        ) : activeTab === "filters" ? (
          <>
            <AiaBox
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
              <AiaBox sx={{ width: 52, textAlign: "center" }}>#</AiaBox>
              <AiaBox sx={{ flex: 1 }}>CONDITION / GROUP</AiaBox>
            </AiaBox>

            <AiaBox sx={{ mt: 2, display: "flex", flexDirection: "column", gap: 1.25 }}>
              {rootGroups.map((group, idx) => renderNode(group, `${idx + 1}`))}
            </AiaBox>
          </>
        ) : activeTab === "grouping" ? (
          <AiaBox sx={{ mt: 2, display: "flex", flexDirection: "column", gap: 1.25 }}>
            <AiaBox
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
              <AiaBox sx={{ textAlign: "center" }}>#</AiaBox>
              <AiaBox>GROUP BY FIELD</AiaBox>
              <AiaBox />
            </AiaBox>
            {groupByItems.map((item, idx) => (
              <AiaBox
                key={item.id}
                sx={{
                  display: "grid",
                  gridTemplateColumns: "52px minmax(0, 320px) auto",
                  gap: 1.25,
                  alignItems: "center",
                  minHeight: 40,
                }}
              >
                <AiaBox sx={{ textAlign: "center", color: "#64748b", fontSize: 12, fontWeight: 500 }}>
                  {idx + 1}
                </AiaBox>
                <AiaAutocomplete
                  hideLabel
                  freeSolo
                  options={allFields}
                  groupBy={(option) => option.group ?? ""}
                  value={item.field}
                  placeholder="Search field…"
                  onChange={(val) => handleUpdateGroupBy(item.id, toFieldValue(val))}
                  fullWidth
                  sx={{ maxWidth: 320, ...fieldAutocompleteSx }}
                />
                <AiaButton
                  variant="text"
                  size="small"
                  rounded="full"
                  onClick={() => handleDeleteGroupBy(item.id)}
                  customColor="#ef4444"
                >
                  ✕
                </AiaButton>
              </AiaBox>
            ))}
          </AiaBox>
        ) : (
          <AiaBox sx={{ mt: 2, display: "flex", flexDirection: "column", gap: 1.25 }}>
            <AiaBox
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
              <AiaBox sx={{ textAlign: "center" }}>#</AiaBox>
              <AiaBox>SORT FIELD</AiaBox>
              <AiaBox>DIRECTION</AiaBox>
              <AiaBox />
            </AiaBox>
            {orderByItems.map((item, idx) => (
              <AiaBox
                key={item.id}
                sx={{
                  display: "grid",
                  gridTemplateColumns: "52px minmax(0, 320px) 120px auto",
                  gap: 1.25,
                  alignItems: "center",
                  minHeight: 40,
                }}
              >
                <AiaBox sx={{ textAlign: "center", color: "#64748b", fontSize: 12, fontWeight: 500 }}>
                  {idx + 1}
                </AiaBox>
                <AiaAutocomplete
                  hideLabel
                  freeSolo
                  options={allFields}
                  groupBy={(option) => option.group ?? ""}
                  value={item.field}
                  placeholder="Search field…"
                  onChange={(val) =>
                    handleUpdateOrderBy(item.id, { field: toFieldValue(val) })
                  }
                  fullWidth
                  sx={{ maxWidth: 320, ...fieldAutocompleteSx }}
                />
                <AiaSelect
                  options={[
                    { label: "Ascending", value: "ASC" },
                    { label: "Descending", value: "DESC" },
                  ]}
                  value={item.direction}
                  onChange={(val) => handleUpdateOrderBy(item.id, { direction: val as SortDirection })}
                  fullWidth
                  sx={{ width: 120, ...selectDensitySx }}
                />
                <AiaButton
                  variant="text"
                  size="small"
                  rounded="full"
                  onClick={() => handleDeleteOrderBy(item.id)}
                  customColor="#ef4444"
                >
                  ✕
                </AiaButton>
              </AiaBox>
            ))}
          </AiaBox>
        )}
      </AiaBox>

      {showPreview && tables.length > 0 && (
        <AiaBox className="filter-preview">
          <SqlEditor
            className="filter-preview__sql-editor"
            value={editablePreviewSql}
            onChange={handlePreviewSqlChange}
            title={previewMode === "expanded" ? `${previewLabel} · DERIVED SOURCES EXPANDED` : previewLabel}
            toolbarActions={(
              <>
                {expandedPreviewSql ? (
                  <>
                    <AiaButton
                      size="small"
                      variant={previewMode === "runtime" ? "contained" : "outlined"}
                      onClick={() => setPreviewMode("runtime")}
                      sx={{ minHeight: 28, py: 0.25, whiteSpace: "nowrap" }}
                    >
                      Runtime view
                    </AiaButton>
                    <AiaButton
                      size="small"
                      variant={previewMode === "expanded" ? "contained" : "outlined"}
                      onClick={() => setPreviewMode("expanded")}
                      sx={{ minHeight: 28, py: 0.25, whiteSpace: "nowrap" }}
                    >
                      Expanded SQL
                    </AiaButton>
                  </>
                ) : null}
                {hasPreviewOverride ? (
                  <AiaButton
                    size="small"
                    variant="text"
                    onClick={handleResetPreviewSql}
                    sx={{ minHeight: 28, py: 0.25, whiteSpace: "nowrap" }}
                  >
                    Reset
                  </AiaButton>
                ) : null}
                <AiaButton
                  size="small"
                  variant="outlined"
                  disabled={isValidatingPreview}
                  onClick={() => void handleValidatePreviewSql()}
                  sx={{ minHeight: 28, py: 0.25, whiteSpace: "nowrap" }}
                >
                  {isValidatingPreview ? "Validating…" : "Validate & Run"}
                </AiaButton>
              </>
            )}
            emptyText="-- No query clauses defined"
            showCopy
            minHeight={SOURCE_QUERY_PREVIEW_HEIGHT}
            maxHeight={SOURCE_QUERY_PREVIEW_HEIGHT}
            showLineNumbers={false}
            sx={{
              width: "100%",
              border: "none",
              borderRadius: 0,
            }}
          />
          {previewValidation ? (
            <AiaBox
              role={previewValidation.type === "error" ? "alert" : "status"}
              sx={{
                px: 1.5,
                py: 1,
                borderTop: "1px solid",
                borderColor: previewValidation.type === "success" ? "#bbf7d0" : "#fecaca",
                backgroundColor: previewValidation.type === "success" ? "#f0fdf4" : "#fef2f2",
              }}
            >
              <AiaText sx={{ fontSize: 12, color: previewValidation.type === "success" ? "#166534" : "#b91c1c" }}>
                {previewValidation.message}
              </AiaText>
            </AiaBox>
          ) : null}
          {validatedPreview ? (
            <AiaBox sx={{ borderTop: "1px solid #e2e8f0", backgroundColor: "#ffffff" }}>
              <AiaBox
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 1,
                  px: 1.5,
                  py: 1,
                  borderBottom: "1px solid #e2e8f0",
                }}
              >
                <AiaText sx={{ fontSize: 12, fontWeight: 700, color: "#334155" }}>
                  Sample data
                </AiaText>
                <AiaText sx={{ fontSize: 11, color: "#64748b" }}>
                  {validatedPreview.columns.length} columns · {validatedPreview.rows.length} rows
                </AiaText>
              </AiaBox>
              {validatedPreview.columns.length ? (
                <AiaBox sx={{ width: "100%", maxHeight: 280, overflow: "auto" }}>
                  <table style={{ width: "max-content", minWidth: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        {validatedPreview.columns.map((column) => (
                          <th
                            key={column.name}
                            style={{
                              position: "sticky",
                              top: 0,
                              zIndex: 1,
                              padding: "8px 12px",
                              borderBottom: "1px solid #cbd5e1",
                              background: "#f8fafc",
                              color: "#334155",
                              fontSize: 11,
                              textAlign: "left",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <div>{column.name}</div>
                            <div style={{ color: "#94a3b8", fontWeight: 400 }}>{column.dataType}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {validatedPreview.rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {validatedPreview.columns.map((column) => (
                            <td
                              key={`${rowIndex}:${column.name}`}
                              style={{
                                maxWidth: 320,
                                padding: "8px 12px",
                                borderBottom: "1px solid #f1f5f9",
                                color: "#475569",
                                fontSize: 11,
                                whiteSpace: "normal",
                                overflowWrap: "anywhere",
                              }}
                            >
                              {row[column.name] == null
                                ? "NULL"
                                : typeof row[column.name] === "object"
                                  ? JSON.stringify(row[column.name])
                                  : String(row[column.name])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </AiaBox>
              ) : (
                <AiaText sx={{ px: 1.5, py: 1.25, fontSize: 12, color: "#64748b" }}>
                  The query is valid but did not return a preview schema.
                </AiaText>
              )}
            </AiaBox>
          ) : null}
        </AiaBox>
      )}
    </AiaBox>
  );
}
