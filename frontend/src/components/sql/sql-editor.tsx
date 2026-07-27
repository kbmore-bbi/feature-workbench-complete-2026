'use client';
import { AiaBox } from '@/components/ui';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  SQL_FUNCTION_CATEGORIES,
  SQL_FUNCTIONS_BY_CATEGORY,
  SQL_QUICK_ACTIONS,
} from './function-library.config';
import { insertSqlSnippet } from './sql-insert';
import { SqlEditorSurface } from './sql-editor-surface';
import { SqlEditorToolbar } from './sql-editor-toolbar';
import { SqlFunctionLibrary } from './sql-function-library';
import {
  SQL_EDITOR_COLORS,
  SQL_EDITOR_DEFAULT_HEIGHT,
  SQL_EDITOR_FRAME_SX,
  SQL_EDITOR_PANEL_MIN_HEIGHT,
  SQL_FUNCTION_LIBRARY_MIN_HEIGHT,
} from './sql-styles';
import type { SqlEditorProps, SqlFunctionCategoryId, SqlInsertOptions } from './types';

const COPY_FEEDBACK_MS = 1500;

export function SqlEditor({
  value,
  onChange,
  readOnly = false,
  title = 'SQL Preview',
  subtitle,
  toolbarActions,
  placeholder = '-- Write SQL here',
  emptyText = '-- No SQL to display',
  showCopy = false,
  onCopy,
  onCopySuccess,
  onCopyError,
  showUpload = false,
  onUpload,
  onUploadError,
  showFunctionLibrary = false,
  quickActions = SQL_QUICK_ACTIONS,
  functionCategories = SQL_FUNCTION_CATEGORIES,
  functionsByCategory = SQL_FUNCTIONS_BY_CATEGORY,
  defaultFunctionCategory = 'string',
  functionLibraryTourTargets,
  showLineNumbers = true,
  fillHeight = false,
  minHeight = SQL_EDITOR_DEFAULT_HEIGHT,
  maxHeight,
  className,
  sx,
}: SqlEditorProps) {
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<SqlFunctionCategoryId>(
    defaultFunctionCategory,
  );

  const resolvedHeight = maxHeight ?? minHeight ?? SQL_EDITOR_DEFAULT_HEIGHT;
  const panelMinHeight = minHeight ?? SQL_EDITOR_PANEL_MIN_HEIGHT;
  const panelMaxHeight = maxHeight ?? (fillHeight ? '100%' : resolvedHeight);
  const containerHeightSx = fillHeight
    ? {
        height: '100%',
        minHeight: panelMinHeight,
        maxHeight: panelMaxHeight,
        flex: 1,
      }
    : {
        height: resolvedHeight,
        minHeight: panelMinHeight,
        maxHeight: panelMaxHeight,
      };

  useEffect(() => {
    if (!copyFeedback) return;
    const timeout = window.setTimeout(() => setCopyFeedback(null), COPY_FEEDBACK_MS);
    return () => window.clearTimeout(timeout);
  }, [copyFeedback]);

  const handleCopyFeedback = useCallback(
    (message: string | null, onNotify?: (message: string) => void) => {
      setCopyFeedback(message);
      if (message && onNotify) {
        onNotify(message);
      }
    },
    [],
  );

  const handleInsert = useCallback(
    (snippet: string, options?: SqlInsertOptions) => {
      if (readOnly || !onChange) return;

      const { start, end } = selectionRef.current;
      const result = insertSqlSnippet(value, snippet, start, end, options);
      onChange(result.nextValue);

      requestAnimationFrame(() => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.focus();
        editor.setSelectionRange(result.selectionStart, result.selectionEnd);
        selectionRef.current = {
          start: result.selectionStart,
          end: result.selectionEnd,
        };
      });
    },
    [onChange, readOnly, value],
  );

  const handleSelectionChange = useCallback((start: number, end: number) => {
    selectionRef.current = { start, end };
  }, []);

  const editorPanel = (
    <>
      <SqlEditorToolbar
        title={title}
        subtitle={subtitle}
        toolbarActions={toolbarActions}
        value={value}
        readOnly={readOnly}
        showCopy={showCopy}
        showUpload={showUpload && !readOnly}
        copyFeedback={copyFeedback}
        onCopy={onCopy}
        onUpload={onUpload}
        onUploadError={onUploadError}
        onCopySuccess={(message) => handleCopyFeedback(message, onCopySuccess)}
        onCopyError={(message) => handleCopyFeedback(message, onCopyError)}
        onCopyFeedback={setCopyFeedback}
      />

      <SqlEditorSurface
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        placeholder={placeholder}
        emptyText={emptyText}
        showLineNumbers={showLineNumbers}
        editorRef={editorRef}
        onSelectionChange={handleSelectionChange}
      />
    </>
  );

  if (showFunctionLibrary) {
    return (
      <AiaBox
        className={className}
        sx={{
          display: 'flex',
          alignItems: 'stretch',
          gap: 1.5,
          width: '100%',
          flexShrink: 0,
          ...containerHeightSx,
          ...sx,
        }}
      >
        <AiaBox
          sx={{
            ...SQL_EDITOR_FRAME_SX,
            flex: 1,
            minWidth: 0,
            minHeight: panelMinHeight,
            maxHeight: panelMaxHeight,
            flexDirection: 'column',
            bgcolor: SQL_EDITOR_COLORS.panelBg,
            color: SQL_EDITOR_COLORS.text,
            overflow: 'hidden',
          }}
        >
          {editorPanel}
        </AiaBox>

        <AiaBox
          sx={{
            ...SQL_EDITOR_FRAME_SX,
            width: 280,
            flexShrink: 0,
            minHeight: SQL_FUNCTION_LIBRARY_MIN_HEIGHT,
            maxHeight: panelMaxHeight,
            height: '100%',
            flexDirection: 'column',
            bgcolor: '#ffffff',
            overflow: 'hidden',
          }}
        >
          <SqlFunctionLibrary
            onInsert={handleInsert}
            activeCategory={activeCategory}
            onCategoryChange={setActiveCategory}
            quickActions={quickActions}
            categories={functionCategories}
            functionsByCategory={functionsByCategory}
            defaultCategory={defaultFunctionCategory}
            libraryTourTarget={functionLibraryTourTargets?.library}
            tabsTourTarget={functionLibraryTourTargets?.tabs}
            panelTourTarget={functionLibraryTourTargets?.panel}
          />
        </AiaBox>
      </AiaBox>
    );
  }

  return (
    <AiaBox
      className={className}
      sx={{
        ...SQL_EDITOR_FRAME_SX,
        flexDirection: 'column',
        width: '100%',
        flexShrink: 0,
        bgcolor: SQL_EDITOR_COLORS.panelBg,
        color: SQL_EDITOR_COLORS.text,
        overflow: 'hidden',
        ...containerHeightSx,
        ...sx,
      }}
    >
      {editorPanel}
    </AiaBox>
  );
}
