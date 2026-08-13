import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';

export type MappingColumnWidths = {
  checkbox: number;
  targetColumn: number;
  sourceColumn: number;
  preProcessRule: number;
  confidence: number;
  typePreview: number;
  nlRule: number;
  order: number;
  description: number;
  status: number;
  dataPreview: number;
};

export type MappingColumnKey = keyof MappingColumnWidths;

/** Default column order: Target → Source → Pre-process → Confidence → ... */
export const MAPPING_COLUMN_KEYS: MappingColumnKey[] = [
  'checkbox',
  'targetColumn',
  'sourceColumn',
  'preProcessRule',
  'confidence',
  'typePreview',
  'nlRule',
  'order',
  'description',
  'status',
  'dataPreview',
];

export function getVisibleMappingColumnKeys(showConfidence: boolean): MappingColumnKey[] {
  if (showConfidence) {
    return MAPPING_COLUMN_KEYS;
  }
  return MAPPING_COLUMN_KEYS.filter((key) => key !== 'confidence');
}

function createDragOverlay() {
  const overlay = document.createElement('div');
  overlay.setAttribute('data-mapping-column-resize-overlay', 'true');
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:10000',
    'cursor:col-resize',
    'user-select:none',
  ].join(';');
  document.body.appendChild(overlay);
  return overlay;
}

export function useMappingColumnWidths(
  defaultWidths: MappingColumnWidths,
  minWidths: MappingColumnWidths,
  visibleKeys: MappingColumnKey[] = MAPPING_COLUMN_KEYS,
) {
  const minWidthsRef = useRef(minWidths);
  minWidthsRef.current = minWidths;

  const columnWidthsRef = useRef(defaultWidths);
  const [columnWidths, setColumnWidths] = useState(defaultWidths);
  columnWidthsRef.current = columnWidths;

  const dragRef = useRef<{
    key: MappingColumnKey;
    startX: number;
    startWidth: number;
  } | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const onResizeStart = useCallback(
    (key: MappingColumnKey, event: ReactMouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();

      dragRef.current = {
        key,
        startX: event.clientX,
        startWidth: columnWidthsRef.current[key],
      };

      overlayRef.current = createDragOverlay();
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!dragRef.current) return;
        moveEvent.preventDefault();
        const delta = moveEvent.clientX - dragRef.current.startX;
        const minWidth = minWidthsRef.current[dragRef.current.key];
        const nextWidth = Math.max(minWidth, dragRef.current.startWidth + delta);
        const nextWidths = {
          ...columnWidthsRef.current,
          [dragRef.current.key]: nextWidth,
        };
        columnWidthsRef.current = nextWidths;
        setColumnWidths(nextWidths);
      };

      const handleMouseUp = () => {
        dragRef.current = null;
        overlayRef.current?.remove();
        overlayRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [],
  );

  const tableMinWidth = useMemo(
    () => visibleKeys.reduce((total, key) => total + columnWidths[key], 0),
    [columnWidths, visibleKeys],
  );

  const frozenTargetColumnLeft = columnWidths.checkbox;

  return {
    columnWidths,
    onResizeStart,
    tableMinWidth,
    frozenTargetColumnLeft,
  };
}
