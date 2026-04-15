'use client';
import CardList from './CardList';


export default function SttmSource() {
    return (
        <>
            <CardList
                singleSelect={false} // true for target
                items={[
                    {
                        id: '1',
                        title: 'Orders',
                        tag: 'Sales',
                        schemaName: 'dbo',
                        dbName: 'SQL Server CRM',
                        rows: '1.2M',
                        columns: 6
                    },
                    {
                        id: '2',
                        title: 'FACT_SALES',
                        tag: 'CORE',
                        schemaName: 'dbo',
                        dbName: 'SQL Server CRM',
                        rows: '1.2M',
                        columns: 6
                    }
                ]}
            />

        </>
    )
}