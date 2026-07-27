'use client';
import { AiaBox } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SqlHighlight } from './sql-highlight';
import {
  SQL_EDITOR_COLORS,
  SQL_EDITOR_METRICS,
  SQL_EDITOR_SCROLL_SX,
  SQL_HIGHLIGHT_DEBOUNCE_MS,
  SQL_MONO_FONT,
} from './sql-styles';
import { tokenizeSql } from './sql-tokenizer';

type SqlEditorSurfaceProps = {
  value: string;
  onChange?: (next: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  emptyText?: string;
  showLineNumbers?: boolean;
  compact?: boolean;
  onSelectionChange?: (start: number, end: number) => void;
  editorRef?: React.RefObject<HTMLTextAreaElement | null>;
};

const editorTextSx = {
  fontFamily: SQL_MONO_FONT,
  fontSize: SQL_EDITOR_METRICS.fontSize,
  lineHeight: SQL_EDITOR_METRICS.lineHeight,
  px: SQL_EDITOR_METRICS.paddingX,
  py: SQL_EDITOR_METRICS.paddingY,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
} as const;

export function SqlEditorSurface({
  value,
  onChange,
  readOnly = false,
  placeholder = '-- Write SQL here',
  emptyText = '-- No SQL to display',
  showLineNumbers = true,
  compact = false,
  onSelectionChange,
  editorRef,
}: SqlEditorSurfaceProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const lineNumbersRef = useRef<HTMLDivElement | null>(null);
  const internalEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const textareaRef = editorRef ?? internalEditorRef;

  const [highlightText, setHighlightText] = useState(value);

  useEffect(() => {
    if (readOnly) {
      setHighlightText(value);
      return;
    }

    const timeout = window.setTimeout(
      () => setHighlightText(value),
      SQL_HIGHLIGHT_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [readOnly, value]);

  const highlightTokens = useMemo(
    () => (highlightText ? tokenizeSql(highlightText) : []),
    [highlightText],
  );

  const lineCount = useMemo(() => Math.max(1, value.split('\n').length), [value]);

  const syncScroll = useCallback((scrollTop: number, scrollLeft: number) => {
    if (overlayRef.current) {
      overlayRef.current.scrollTop = scrollTop;
      overlayRef.current.scrollLeft = scrollLeft;
    }
    if (lineNumbersRef.current) {
      lineNumbersRef.current.style.transform = `translateY(-${scrollTop}px)`;
    }
  }, []);

  if (readOnly) {
    const readOnlyPaddingX = compact ? 1.5 : 3;
    const readOnlyPaddingY = compact ? 1.35 : 2;
    const readOnlyFontSize = compact ? '13.25px' : SQL_EDITOR_METRICS.fontSize;
    const readOnlyLineHeight = compact ? 1.72 : 1.65;

    return (
      <AiaBox
        sx={{
          flex: 1,
          minHeight: 0,
          px: readOnlyPaddingX,
          pt: 0,
          pb: readOnlyPaddingY,
          bgcolor: 'transparent',
          ...SQL_EDITOR_SCROLL_SX,
        }}
      >
        {value.trim() ? (
          <AiaBox
            component="pre"
            sx={{
              m: 0,
              fontFamily: SQL_MONO_FONT,
              fontSize: readOnlyFontSize,
              color: '#cbd5e1',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              lineHeight: readOnlyLineHeight,
            }}
          >
            <SqlHighlight text={value} tokens={highlightTokens} />
          </AiaBox>
        ) : (
          <AiaText
            sx={{
              fontFamily: SQL_MONO_FONT,
              fontSize: compact ? readOnlyFontSize : '0.78rem',
              color: SQL_EDITOR_COLORS.muted,
              fontStyle: 'italic',
              lineHeight: readOnlyLineHeight,
            }}
          >
            {emptyText}
          </AiaText>
        )}
      </AiaBox>
    );
  }

  return (
    <AiaBox
      sx={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
        bgcolor: SQL_EDITOR_COLORS.panelBg,
      }}
    >
      {showLineNumbers ? (
        <AiaBox
          sx={{
            width: SQL_EDITOR_METRICS.lineNumberWidth,
            flexShrink: 0,
            alignSelf: 'stretch',
            borderRight: `1px solid ${SQL_EDITOR_COLORS.border}`,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <AiaBox
            ref={lineNumbersRef}
            sx={{
              py: SQL_EDITOR_METRICS.paddingY,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              fontFamily: SQL_MONO_FONT,
              fontSize: '0.75rem',
              lineHeight: SQL_EDITOR_METRICS.lineHeight,
              color: SQL_EDITOR_COLORS.muted,
              pointerEvents: 'none',
              userSelect: 'none',
              willChange: 'transform',
            }}
          >
            {Array.from({ length: lineCount }, (_, index) => (
              <AiaBox key={index + 1}>{index + 1}</AiaBox>
            ))}
          </AiaBox>
        </AiaBox>
      ) : null}

      <AiaBox sx={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0 }}>
        <AiaBox
          ref={overlayRef}
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
            pointerEvents: 'none',
            color: SQL_EDITOR_COLORS.text,
            ...editorTextSx,
          }}
        >
          {highlightText ? (
            <SqlHighlight text={highlightText} tokens={highlightTokens} />
          ) : null}
        </AiaBox>

        <AiaBox
          component="textarea"
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          onSelect={(event) => {
            onSelectionChange?.(
              event.currentTarget.selectionStart,
              event.currentTarget.selectionEnd,
            );
          }}
          onScroll={(event) => {
            syncScroll(event.currentTarget.scrollTop, event.currentTarget.scrollLeft);
          }}
          placeholder={placeholder}
          spellCheck={false}
          sx={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            resize: 'none',
            border: 'none',
            bgcolor: 'transparent',
            color: 'transparent',
            caretColor: SQL_EDITOR_COLORS.text,
            WebkitTextFillColor: 'transparent',
            outline: 'none',
            boxSizing: 'border-box',
            ...editorTextSx,
            ...SQL_EDITOR_SCROLL_SX,
            '&::placeholder': {
              color: SQL_EDITOR_COLORS.placeholder,
              WebkitTextFillColor: SQL_EDITOR_COLORS.placeholder,
            },
            '&::selection': {
              bgcolor: SQL_EDITOR_COLORS.selection,
              WebkitTextFillColor: 'transparent',
            },
          }}
        />
      </AiaBox>
    </AiaBox>
  );
}
