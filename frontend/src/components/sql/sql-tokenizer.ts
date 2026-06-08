export type SqlTokenType =
  | 'comment'
  | 'string'
  | 'number'
  | 'keyword'
  | 'function'
  | 'identifier'
  | 'punctuation'
  | 'space'
  | 'other';

export type SqlToken = { type: SqlTokenType; value: string };

const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'FULL', 'CROSS',
  'ON', 'AS', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'BY', 'ORDER', 'GROUP', 'HAVING',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'DISTINCT', 'UNION', 'ALL', 'OVER', 'PARTITION',
  'LIMIT', 'OFFSET', 'ASC', 'DESC', 'LIKE', 'BETWEEN', 'EXISTS', 'INTO', 'WITH', 'USING',
  'TRUE', 'FALSE',
]);

export const SQL_TOKEN_COLORS: Record<SqlTokenType, string> = {
  comment: '#6b7280',
  string: '#86efac',
  number: '#fbbf24',
  keyword: '#f87171',
  function: '#fb7185',
  identifier: '#e5e7eb',
  punctuation: '#cbd5e1',
  space: 'inherit',
  other: '#e5e7eb',
};

const SQL_TOKEN_PATTERN =
  /(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)|([=<>!+\-*/(),;.])|(\s+)|([^\s])/g;

export function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  if (!sql) return tokens;

  SQL_TOKEN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = SQL_TOKEN_PATTERN.exec(sql)) !== null) {
    const [, comment, str, num, word, punct, space, other] = match;

    if (comment != null) {
      tokens.push({ type: 'comment', value: comment });
    } else if (str != null) {
      tokens.push({ type: 'string', value: str });
    } else if (num != null) {
      tokens.push({ type: 'number', value: num });
    } else if (word != null) {
      const upper = word.toUpperCase();
      const nextChar = sql[match.index + word.length];
      if (SQL_KEYWORDS.has(upper)) {
        tokens.push({ type: 'keyword', value: word });
      } else if (nextChar === '(' && !word.includes('.')) {
        tokens.push({ type: 'function', value: word });
      } else {
        tokens.push({ type: 'identifier', value: word });
      }
    } else if (punct != null) {
      tokens.push({ type: 'punctuation', value: punct });
    } else if (space != null) {
      tokens.push({ type: 'space', value: space });
    } else {
      tokens.push({ type: 'other', value: other ?? '' });
    }
  }

  return tokens;
}
