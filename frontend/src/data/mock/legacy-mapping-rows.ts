export interface MappingRow {
    id: number;

    selected: boolean;

    targetColumn: {
        name: string;
        dataType: 'INT' | 'BIGINT' | 'DECIMAL' | 'VARCHAR' | 'DATE';
    };

    sourceColumn: {
        name?: string;          // empty when unmapped
        dataType?: string;
    };

    previewType: string;

    transformRule: {
        value: string;
        options: string[];
    };

    nlRule?: string;

    preProcessingStatus: 'MAPPED' | 'UNMAPPED';
}

export const mappingTableRows: MappingRow[] = [
    {
        id: 1,
        selected: true,
        targetColumn: {
            name: 'ORDER_ID',
            dataType: 'BIGINT',
        },
        sourceColumn: {
            name: 'orders.order_id',
            dataType: 'BIGINT',
        },
        previewType: 'BIGINT',
        transformRule: {
            value: 'Direct',
            options: ['Direct', 'Lookup', 'Expression'],
        },
        nlRule: '',
        preProcessingStatus: 'MAPPED',
    },
    {
        id: 2,
        selected: false,
        targetColumn: {
            name: 'CUSTOMER_KEY',
            dataType: 'INT',
        },
        sourceColumn: {},
        previewType: 'INT',
        transformRule: {
            value: '',
            options: ['Direct', 'Lookup', 'Expression'],
        },
        nlRule: '',
        preProcessingStatus: 'UNMAPPED',
    },
    {
        id: 3,
        selected: false,
        targetColumn: {
            name: 'DATE_KEY',
            dataType: 'INT',
        },
        sourceColumn: {},
        previewType: 'INT',
        transformRule: {
            value: '',
            options: ['Direct', 'Lookup', 'Expression'],
        },
        nlRule: '',
        preProcessingStatus: 'UNMAPPED',
    },
    {
        id: 4,
        selected: false,
        targetColumn: {
            name: 'AMOUNT',
            dataType: 'DECIMAL',
        },
        sourceColumn: {},
        previewType: 'DECIMAL',
        transformRule: {
            value: '',
            options: ['Direct', 'Expression'],
        },
        nlRule: '',
        preProcessingStatus: 'UNMAPPED',
    },
];
