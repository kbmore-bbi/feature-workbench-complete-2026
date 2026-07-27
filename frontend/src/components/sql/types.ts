export type SqlFunctionCategoryId =
  | 'string'
  | 'numeric'
  | 'date'
  | 'conversion'
  | 'logic'
  | 'window';

export type SqlFunctionCategory = {
  id: SqlFunctionCategoryId;
  label: string;
};

export type SqlSnippetAction = {
  id: string;
  label: string;
  snippet: string;
  /** When true, wraps existing editor content inside `()` functions like `UPPER()`. */
  wrapExisting?: boolean;
};

export type SqlInsertOptions = {
  wrapExisting?: boolean;
};

export type SqlEditorProps = {
  value: string;
  onChange?: (next: string) => void;
  readOnly?: boolean;

  title?: string;
  subtitle?: string;
  /** Optional controls rendered in the SQL toolbar beside the built-in actions. */
  toolbarActions?: import('react').ReactNode;
  placeholder?: string;
  emptyText?: string;

  showCopy?: boolean;
  onCopy?: () => void | Promise<void>;
  onCopySuccess?: (message: string) => void;
  onCopyError?: (message: string) => void;

  showUpload?: boolean;
  onUpload?: (content: string, fileName: string) => void;
  onUploadError?: (message: string) => void;

  /** When true, renders the shared Function Library on the right of the editor. */
  showFunctionLibrary?: boolean;

  quickActions?: SqlSnippetAction[];
  functionCategories?: SqlFunctionCategory[];
  functionsByCategory?: Record<SqlFunctionCategoryId, string[]>;
  defaultFunctionCategory?: SqlFunctionCategoryId;

  /** Optional `data-tour` anchors for the function library panel (e.g. derived-table modal tour). */
  functionLibraryTourTargets?: {
    library?: string;
    panel?: string;
    tabs?: string;
  };

  showLineNumbers?: boolean;
  /** Fill parent height with min/max bounds instead of a fixed height. */
  fillHeight?: boolean;
  minHeight?: number | string;
  maxHeight?: number | string;
  className?: string;
  sx?: import('@mui/material/styles').SxProps;
};
