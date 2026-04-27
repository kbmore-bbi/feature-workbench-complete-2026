'use client';

import { useState } from "react";
import { FocusSelect } from "@/components/ui/focus-select";
import { FocusInput } from "@/components/ui/focus-input";
import { FocusAutocomplete } from "@/components/ui/focus-auto-complete";
import { FocusTable } from "@/components/ui/focus-table/focus-table";
import { FocusTable as D } from "@/components/ui/focus-table";
import { FocusChip } from "@/components/ui/focus-chip";
import { FocusTableRow } from "@/components/ui/focus-table/focus-table-row";
import { FocusCheckboxCell } from "@/components/ui/focus-table/focus-checkbox-cell";
import { FocusColumnCell } from "@/components/ui/focus-table/focus-column-cell";
import { FocusChipCell } from "@/components/ui/focus-table/focus-chip-cell";
import { FocusSelectCell } from "@/components/ui/focus-table/focus-select-cell";
import { FocusInputCell } from "@/components/ui/focus-table/focus-input-cell";
import { FocusStatusCell } from "@/components/ui/focus-table/focus-status-cell";
import { TableCell } from "@mui/material";
import { mappingTableRows } from '@/data/table'

export default function Page() {
    const [tables, setTables] = useState<string[]>(['C', 'D']);
    const [db, setDb] = useState('');

    const DEFAULT_OPTIONS: any[] = [
        { label: 'Option A', value: 'A' },
        { label: 'Option B', value: 'B' },
        { label: 'Option C', value: 'C' },
        { label: 'Option D', value: 'D' },
        { label: 'Option E', value: 'E' },
        { label: 'Option F', value: 'F' },
        { label: 'Option G', value: 'G' },
        { label: 'Option H', value: 'H' },
        { label: 'Option I', value: 'I' },
        { label: 'Option J', value: 'J' },
    ];


    const columns = [
        { key: 'name', label: 'Name' },
        { key: 'type', label: 'Type' },
        {
            key: 'rows',
            label: 'Rows',
            align: 'right',
        },
    ];

    return (
        <>
            <h1>STTM Viewer</h1>
            <br />
            <br />
            <br />

            <div style={{ display: 'flex', flexDirection: 'row', gap: '16px', width: '500px', margin: '20px' }}>
                <FocusSelect
                    value={db}
                    options={DEFAULT_OPTIONS}
                    size={'small'}
                    onChange={(value) => {
                        console.log(value);
                        setDb(value as string)
                    }}
                />
                <FocusSelect
                    label="Tables"
                    multiple
                    value={tables}
                    size={'medium'}
                    options={DEFAULT_OPTIONS}
                    onChange={(value) => {
                        console.log(value);
                        setTables(value as string[])
                    }}
                />
            </div>
            <div style={{ display: 'flex', flexDirection: 'row', gap: '16px', width: '600px', margin: '20px' }}>
                <FocusInput />
                <FocusAutocomplete
                    options={DEFAULT_OPTIONS}
                    size={'small'}
                    multiple={false}
                    value={db}
                    onChange={(value) => {
                        console.log(value);
                        setDb(value as string)
                    }}
                />
            </div>
            <div style={{ display: 'flex', flexDirection: 'row', gap: '16px', width: '600px', margin: '20px' }}>
                <D
                    columns={columns}
                    rows={tables}
                    onRowClick={(row) => console.log(row)}
                />

            </div>
            <div style={{ display: 'flex', flexDirection: 'row', gap: '16px', width: '600px', margin: '20px' }}>
                <FocusChip label="Example Chip" color={'primary'} rounded={false} />

            </div>
            <div style={{ display: 'flex', flexDirection: 'row', gap: '16px', width: '80%', 
                margin: '100px' }}>

                <FocusTable columns={mappingTableColumns}>
                    {mappingTableRows.map((row) => (
                        <FocusTableRow key={row.id}>
                            <FocusCheckboxCell checked={row.selected} />
                            <TableCell align="center">{row.id}</TableCell>

                            <FocusColumnCell
                                name={row.targetColumn.name}
                                type={row.targetColumn.dataType}
                            />

                            <FocusColumnCell
                                name={row.sourceColumn.name ?? 'Map source…'}
                                type={row.sourceColumn.dataType ?? ''}
                            />

                            <FocusChipCell label={row.previewType} />

                            <FocusSelectCell
                                value={row.transformRule.value}
                                options={row.transformRule.options}
                            />

                            <FocusInputCell placeholder="Add NL rule…" />

                            <FocusStatusCell status={row.preProcessingStatus} />
                        </FocusTableRow>
                    ))}
                </FocusTable>
                

            </div>

        </>
    )
}


export const mappingTableColumns = [
    { key: 'select', label: '', align: 'center' },
    { key: 'index', label: '#', align: 'center' },
    { key: 'targetColumn', label: 'Target Column' },
    { key: 'sourceColumn', label: 'Source Column' },
    { key: 'previewType', label: 'Type (Preview)' },
    { key: 'transformRule', label: 'Transform Rule' },
    { key: 'nlRule', label: 'NL Rule' },
    { key: 'preProcessing', label: 'Pre‑processing Order Status', align: 'right' },
];


