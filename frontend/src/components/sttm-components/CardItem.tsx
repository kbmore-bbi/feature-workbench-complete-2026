'use client';
import React from 'react';
import './SttmComponents.css';

export interface CardItemProps {
  id?: string;
  title?: string;
  tag?: string;
  schemaName?: string;
  dbName?: string;
  rows?: string;
  columns?: number;
  selected?: boolean;
  onSelect?: (id?: string) => void;
}


export const CardItem: React.FC<CardItemProps> = ({
  id,
  title,
  tag,
  schemaName,
  dbName,
  rows,
  columns,
  selected,
  onSelect
}) => {
  return (
    <div className={`card-item ${selected ? 'selected' : ''}`}>
      {/* LEFT */}
      <div className="card-left">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onSelect(id)}
        />

        <div className="table-icon">▦</div>

        <div className="card-title">
          <span className="title">{title}</span>
          <span className="tag">{tag}</span>

          <div className="sub-text">
            {schemaName} • {dbName}
          </div>
        </div>
      </div>

      {/* RIGHT */}
      <div className="card-right">
        <div className="metric">
          <span className="value">{rows}</span>
          <span className="label">rows</span>
        </div>

        <div className="metric">
          <span className="value">{columns}</span>
          <span className="label">cols</span>
        </div>
      </div>
    </div>
  );
};