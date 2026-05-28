import type { SqlInsertOptions } from './types';

type InsertResult = {
  nextValue: string;
  selectionStart: number;
  selectionEnd: number;
};

function wrapExistingSnippet(current: string, snippet: string) {
  if (!snippet.includes('()')) {
    return current.trim() ? `${current.trim()} ${snippet}` : snippet;
  }
  if (!current.trim()) {
    return snippet;
  }
  return snippet.replace('()', `(${current.trim()})`);
}

function buildInsertText(before: string, snippet: string) {
  const needsSpace =
    before.length > 0 &&
    !/\s$/.test(before) &&
    snippet.length > 0 &&
    !/^\s/.test(snippet);

  return `${needsSpace ? ' ' : ''}${snippet}`;
}

export function insertSqlSnippet(
  current: string,
  snippet: string,
  selectionStart: number,
  selectionEnd: number,
  options: SqlInsertOptions = {},
): InsertResult {
  const selected = current.slice(selectionStart, selectionEnd);
  const before = current.slice(0, selectionStart);
  const after = current.slice(selectionEnd);

  if (options.wrapExisting) {
    const inserted = wrapExistingSnippet(selected || current, snippet);
    if (selected) {
      const nextValue = `${before}${inserted}${after}`;
      const cursor = before.length + inserted.length;
      return { nextValue, selectionStart: cursor, selectionEnd: cursor };
    }
    return {
      nextValue: inserted,
      selectionStart: inserted.length,
      selectionEnd: inserted.length,
    };
  }

  if (selectionStart !== selectionEnd) {
    const nextValue = `${before}${snippet}${after}`;
    const cursor = before.length + snippet.length;
    return { nextValue, selectionStart: cursor, selectionEnd: cursor };
  }

  const insertedText = buildInsertText(before, snippet);
  const nextValue = `${before}${insertedText}${after}`;
  const cursor = before.length + insertedText.length;
  return { nextValue, selectionStart: cursor, selectionEnd: cursor };
}
