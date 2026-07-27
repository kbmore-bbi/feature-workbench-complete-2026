'use client';
import { AiaBox, AiaChip, AiaPaper, AiaStack } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import { useMemo, useState } from 'react';

import {
  SqlEditor,
  SQL_DERIVED_QUICK_ACTIONS,
  SQL_EDITOR_DEFAULT_HEIGHT,
  SQL_EDITOR_DERIVED_HEIGHT,
  SQL_EDITOR_PREVIEW_HEIGHT,
} from '@/components/sql';

type PlaygroundMode = 'preprocess' | 'derived' | 'readonly';

const SAMPLE_SQL = `SELECT
  UPPER(a.customer_name) AS customer_name,
  CASE WHEN a.status = 'ACTIVE' THEN 1 ELSE 0 END AS is_active
FROM sales.customer a
INNER JOIN sales.orders b
  ON a.customer_id = b.customer_id
WHERE a.region = 'EMEA';`;

const MODES: { id: PlaygroundMode; label: string; description: string }[] = [
  {
    id: 'preprocess',
    label: 'Pre-Process',
    description: 'Editable SQL + function library on the right (mapping modal style).',
  },
  {
    id: 'derived',
    label: 'Derived Table',
    description: 'Editable SQL + function library on the right + upload + derived shortcuts.',
  },
  {
    id: 'readonly',
    label: 'Read-only Preview',
    description: 'Syntax-highlighted preview with copy only (join / mapping preview style).',
  },
];

export default function SqlEditorPlaygroundPage() {
  const [mode, setMode] = useState<PlaygroundMode>('preprocess');
  const [sql, setSql] = useState(SAMPLE_SQL);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);

  const activeMode = useMemo(
    () => MODES.find((item) => item.id === mode) ?? MODES[0],
    [mode],
  );

  return (
    <AiaBox
      sx={{
        minHeight: 'calc(100vh - 64px)',
        bgcolor: '#f8fafc',
        p: { xs: 2, md: 3 },
      }}
    >
      <AiaStack spacing={2} sx={{ maxWidth: 1400, mx: 'auto', height: '100%' }}>
        <AiaBox>
          <AiaText sx={{ fontSize: '1.35rem', fontWeight: 800, color: '#0f172a' }}>
            SQL Editor Playground
          </AiaText>
          <AiaText sx={{ fontSize: '0.9rem', color: '#64748b', mt: 0.5 }}>
            Dev page for validating the shared SqlEditor and Function Library components.
          </AiaText>
        </AiaBox>

        <AiaStack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          {MODES.map((item) => (
            <AiaChip
              key={item.id}
              label={item.label}
              clickable
              color={mode === item.id ? 'primary' : 'default'}
              onClick={() => setMode(item.id)}
              sx={{ fontWeight: 700 }}
            />
          ))}
        </AiaStack>

        <AiaPaper
          elevation={0}
          sx={{
            p: 2,
            borderRadius: 3,
            border: '1px solid #e2e8f0',
            bgcolor: '#fff',
          }}
        >
          <AiaText sx={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b' }}>
            {activeMode.label}
          </AiaText>
          <AiaText sx={{ fontSize: '0.82rem', color: '#64748b', mt: 0.5 }}>
            {activeMode.description}
          </AiaText>
          {uploadMessage ? (
            <AiaText sx={{ fontSize: '0.78rem', color: '#059669', mt: 1, fontWeight: 600 }}>
              {uploadMessage}
            </AiaText>
          ) : null}
        </AiaPaper>

        <AiaBox sx={{ width: '100%' }}>
          {mode === 'preprocess' ? (
            <SqlEditor
              value={sql}
              onChange={setSql}
              title="SQL Preview"
              subtitle="2 joins from Step 1"
              placeholder="-- Write SQL here"
              showCopy
              showFunctionLibrary
              minHeight={SQL_EDITOR_DEFAULT_HEIGHT}
              maxHeight={SQL_EDITOR_DEFAULT_HEIGHT}
            />
          ) : null}

          {mode === 'derived' ? (
            <SqlEditor
              value={sql}
              onChange={setSql}
              title="Custom SQL"
              placeholder="-- Paste, upload, or build SQL here"
              showCopy
              showUpload
              onUpload={(content, fileName) => {
                setSql(content);
                setUploadMessage(`Loaded SQL from ${fileName}`);
              }}
              showFunctionLibrary
              quickActions={SQL_DERIVED_QUICK_ACTIONS}
              minHeight={SQL_EDITOR_DERIVED_HEIGHT}
              maxHeight={SQL_EDITOR_DERIVED_HEIGHT}
            />
          ) : null}

          {mode === 'readonly' ? (
            <SqlEditor
              value={sql}
              readOnly
              title="SQL Preview"
              subtitle="Live generated SQL"
              emptyText="-- No SQL to display"
              showCopy
              minHeight={SQL_EDITOR_PREVIEW_HEIGHT}
              maxHeight={SQL_EDITOR_PREVIEW_HEIGHT}
            />
          ) : null}
        </AiaBox>
      </AiaStack>
    </AiaBox>
  );
}
