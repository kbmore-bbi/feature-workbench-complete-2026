"use client";

import { useEffect, useState } from "react";
import { Box } from "@mui/material";
import { useSidebarSlot } from "@/features/sttm/layout/sidebar-slot-context";
import SourceTargetPanel from "@/features/sttm/source-target/source-target-panel";
import SourceTargetDbSelection from "@/features/sttm/source-target/source-target-db-selection";
import { TableRelationshipPanel } from "@/features/sttm/source-target/table-relationship-panel";

import { TableMeta } from "@/features/sttm/types/sttm.types";
import SourceTargetFilterConditions from "@/features/sttm/source-target/source-target-filter-conditions";


export default function SttmBuilderPage() {
  const [showRelationships, setShowRelationships] = useState(false);

  const tables: any[] = [
    {
      schema: "SALES",
      name: "Orders",
      columns: [
        { name: "ORDER_ID", type: "BIGINT" },
        { name: "CUST_ID", type: "INT" },
        { name: "PRODUCT_ID", type: "INT" },
        { name: "ORDER_DATE", type: "DATE" },
        { name: "AMOUNT", type: "DECIMAL" },
        { name: "STATUS", type: "VARCHAR" },
      ],
    },
    {
      schema: "SALES",
      name: "Customers",
      columns: [
        { name: "CUST_ID", type: "INT" },
        { name: "NAME", type: "VARCHAR" },
        { name: "EMAIL", type: "VARCHAR" },
        { name: "PHONE", type: "VARCHAR" },
        { name: "LOCATION", type: "VARCHAR" },
        { name: "JOINED_DATE", type: "DATE" },
      ],
    },
  ];

  const { setContent } = useSidebarSlot();

  useEffect(() => {
    setContent(<SourceTargetDbSelection />);
  }, [setContent]);

  return (
    <div className="w-full flex flex-col gap-6">
      {/* Panels container: Column on mobile, Row on large screens */}
      <div className="flex flex-col lg:flex-row gap-4">

        {/* Source panel */}
        <div className="flex-1 min-h-[450px]">
          <SourceTargetPanel type="source" />
        </div>

        {/* Target panel */}
        <div className="flex-1 min-h-[450px]">
          <SourceTargetPanel type="target" />
        </div>

      </div>

      {/* Table Relationships section */}
      <div
      
      >
        <TableRelationshipPanel tables={tables} />
      </div>
      <div>
        <SourceTargetFilterConditions/>
      </div>
    </div>
  );
}
