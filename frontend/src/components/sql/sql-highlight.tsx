'use client';

import { memo, useMemo } from 'react';
import { SQL_TOKEN_COLORS, tokenizeSql, type SqlToken } from './sql-tokenizer';

type SqlHighlightProps = {
  text: string;
  tokens?: SqlToken[];
};

function SqlHighlightComponent({ text, tokens: providedTokens }: SqlHighlightProps) {
  const tokens = useMemo(
    () => providedTokens ?? tokenizeSql(text),
    [providedTokens, text],
  );

  if (!text || tokens.length === 0) return null;

  return (
    <>
      {tokens.map((token, idx) => (
        <span
          key={`${idx}-${token.type}`}
          style={{
            color: SQL_TOKEN_COLORS[token.type],
            fontWeight:
              token.type === 'keyword' || token.type === 'function' ? 600 : 400,
          }}
        >
          {token.value}
        </span>
      ))}
    </>
  );
}

export const SqlHighlight = memo(SqlHighlightComponent);
