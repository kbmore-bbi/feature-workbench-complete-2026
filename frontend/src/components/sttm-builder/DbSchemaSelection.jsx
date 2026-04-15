'use client';

export default function DbSchemaSelection() {



    return (
        <div className="flex gap-2 mb-3">
            <select
                className="w-1/2 border rounded-md px-3 py-1.5 text-sm text-gray-700 bg-white"
                defaultValue=""
            >
                <option value="" disabled>Select Database</option>
                <option>SQL Server CRM</option>
                <option>Oracle Finance</option>
                <option>Postgres Ops</option>
            </select>

            <select
                className="w-1/2 border rounded-md px-3 py-1.5 text-sm text-gray-700 bg-white"
                defaultValue=""
            >
                <option value="" disabled>Select Schema</option>
                <option>dbo</option>
                <option>core</option>
                <option>staging</option>
            </select>
        </div>
    );
}
``