'use client';

import { useCallback, useMemo, useState } from 'react';
import { Box, Typography } from '@mui/material';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import { FocusChip } from '@/components/ui/focus-chip';
import {
  SQL_FUNCTION_CATEGORIES,
  SQL_FUNCTIONS_BY_CATEGORY,
  SQL_QUICK_ACTIONS,
} from './function-library.config';
import {
  SQL_FUNCTION_CHIP_SX,
  SQL_PANEL_SCROLL_SX,
} from './sql-styles';
import type {
  SqlFunctionCategory,
  SqlFunctionCategoryId,
  SqlInsertOptions,
  SqlSnippetAction,
} from './types';

const categoryTabSx = (isActive: boolean) => ({
  px: 1.25,
  py: 0.5,
  borderRadius: '7px',
  cursor: 'pointer',
  fontSize: '0.74rem',
  fontWeight: 600,
  color: isActive ? '#111827' : '#6b7280',
  bgcolor: isActive ? '#ffffff' : 'transparent',
  boxShadow: isActive
    ? '0 1px 2px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(15, 23, 42, 0.04)'
    : 'none',
  transition: 'background-color 120ms ease, color 120ms ease, box-shadow 120ms ease',
  '&:hover': {
    bgcolor: isActive ? '#ffffff' : 'rgba(255,255,255,0.55)',
    color: '#111827',
  },
});

export type SqlFunctionLibraryProps = {
  onInsert: (snippet: string, options?: SqlInsertOptions) => void;
  activeCategory?: SqlFunctionCategoryId;
  onCategoryChange?: (category: SqlFunctionCategoryId) => void;
  quickActions?: SqlSnippetAction[];
  categories?: SqlFunctionCategory[];
  functionsByCategory?: Record<SqlFunctionCategoryId, string[]>;
  defaultCategory?: SqlFunctionCategoryId;
};

export function SqlFunctionLibrary({
  onInsert,
  activeCategory,
  onCategoryChange,
  quickActions = SQL_QUICK_ACTIONS,
  categories = SQL_FUNCTION_CATEGORIES,
  functionsByCategory = SQL_FUNCTIONS_BY_CATEGORY,
  defaultCategory = 'string',
}: SqlFunctionLibraryProps) {
  const [internalCategory, setInternalCategory] = useState<SqlFunctionCategoryId>(defaultCategory);
  const selectedCategory = activeCategory ?? internalCategory;

  const categoryFunctions = useMemo(
    () => functionsByCategory[selectedCategory] ?? [],
    [functionsByCategory, selectedCategory],
  );

  const handleCategoryChange = useCallback(
    (category: SqlFunctionCategoryId) => {
      if (onCategoryChange) {
        onCategoryChange(category);
        return;
      }
      setInternalCategory(category);
    },
    [onCategoryChange],
  );

  const handleQuickAction = useCallback(
    (action: SqlSnippetAction) => {
      onInsert(action.snippet, { wrapExisting: action.wrapExisting });
    },
    [onInsert],
  );

  const handleFunctionClick = useCallback(
    (fn: string) => {
      onInsert(fn, { wrapExisting: /^\w+\(\)$/.test(fn) });
    },
    [onInsert],
  );

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: '#fff',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          px: 2,
          py: 1.25,
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          flexShrink: 0,
        }}
      >
        <MenuRoundedIcon sx={{ fontSize: 16, color: '#374151' }} />
        <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: '#111827' }}>
          Function Library
        </Typography>
      </Box>

      <Box
        sx={{
          px: 1.5,
          pt: 1.25,
          pb: 1,
          flexShrink: 0,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 0.5,
            p: 0.5,
            bgcolor: '#f3f4f6',
            borderRadius: '10px',
          }}
        >
          {categories.map((tab) => (
            <Box
              key={tab.id}
              onClick={() => handleCategoryChange(tab.id)}
              sx={categoryTabSx(selectedCategory === tab.id)}
            >
              {tab.label}
            </Box>
          ))}
        </Box>
      </Box>

      <Box
        sx={{
          px: 1.5,
          py: 1.25,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 0.5,
          borderBottom: '1px solid #f1f5f9',
          flexShrink: 0,
          maxHeight: 120,
          ...SQL_PANEL_SCROLL_SX,
        }}
      >
        {quickActions.map((action) => (
          <FocusChip
            key={action.id}
            label={action.label}
            size="small"
            color="default"
            variant="outlined"
            onClick={() => handleQuickAction(action)}
            sx={SQL_FUNCTION_CHIP_SX}
          />
        ))}
      </Box>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          px: 1.5,
          py: 1.25,
          display: 'flex',
          flexWrap: 'wrap',
          alignContent: 'flex-start',
          gap: 0.5,
          ...SQL_PANEL_SCROLL_SX,
        }}
      >
        {categoryFunctions.map((fn) => (
          <FocusChip
            key={fn}
            label={fn}
            size="small"
            color="default"
            variant="outlined"
            onClick={() => handleFunctionClick(fn)}
            sx={SQL_FUNCTION_CHIP_SX}
          />
        ))}
      </Box>
    </Box>
  );
}
