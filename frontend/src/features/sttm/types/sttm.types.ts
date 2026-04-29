export interface Sttm {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

// -----------------
export interface Column {
  name: string;
  type: string;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
}

export interface TableMeta {
  schema: string;
  name: string;
  rowCount: string;
  columns: Column[];
}
export interface TableJoin {
  id: string;
  joinType: "INNER" | "LEFT" | "RIGHT" | "FULL";
  leftTable: string;
  rightTable: string;
  leftColumn: string;
  rightColumn: string;
}
// -----------------