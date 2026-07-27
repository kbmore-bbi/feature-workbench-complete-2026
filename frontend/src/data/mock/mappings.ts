export type MappingListStatus = "Complete" | "Partial" | "Draft";

export type AllMappingListItem = {
  id: string;
  index: number;
  name: string;
  qualifiedName: string;
  status: MappingListStatus;
  projectId: string;
  projectName: string;
  aiSummary: string;
  createdBy: {
    initials: string;
    name: string;
  };
  createdAt: string;
  relativeTime: string;
};

export const MOCK_ALL_MAPPINGS: AllMappingListItem[] = [
  {
    id: "mapping-1",
    index: 1,
    name: "FACT_SALES_UNIFIED",
    qualifiedName: "ENTERPRISE_DWH.PUBLISH.FACT_SALES_UNIFIED",
    status: "Partial",
    projectId: "sales-analytics",
    projectName: "Sales Analytics",
    aiSummary:
      "Maps transactional sales data from the SALES schema Orders and Customers tables into a unified fact with join on CUSTOMER_ID and DATE_FORMAT conversion on date keys.",
    createdBy: { initials: "SW", name: "Shane Watson" },
    createdAt: "14 Apr 2026 - 09:22",
    relativeTime: "49d ago",
  },
  {
    id: "mapping-2",
    index: 2,
    name: "DIM_CUSTOMER_CONFORMED",
    qualifiedName: "ENTERPRISE_DWH.DWH_CUSTOMER.DIM_CUSTOMER_MASTER",
    status: "Complete",
    projectId: "customer-360",
    projectName: "Customer 360",
    aiSummary:
      "Consolidates customer demographic attributes from MDM and profile sources with deduplication on email and phone keys.",
    createdBy: { initials: "PM", name: "Priya Mehta" },
    createdAt: "08 Apr 2026 - 14:05",
    relativeTime: "55d ago",
  },
  {
    id: "mapping-3",
    index: 3,
    name: "DWH.FACT_ORDERS_DAILY",
    qualifiedName: "ENTERPRISE_DWH.DWH_SALES.FACT_ORDERS_DAILY",
    status: "Complete",
    projectId: "sales-analytics",
    projectName: "Sales Analytics",
    aiSummary:
      "Aggregates order line items to daily grain with window functions for running totals and discount adjustments.",
    createdBy: { initials: "AK", name: "Arjun Kapoor" },
    createdAt: "02 Apr 2026 - 11:40",
    relativeTime: "61d ago",
  },
  {
    id: "mapping-4",
    index: 4,
    name: "STG_API_EVENTS_RAW",
    qualifiedName: "SALES_DB.SALES_STAGING.STG_API_EVENTS",
    status: "Draft",
    projectId: "finance-dwh",
    projectName: "Finance DWH",
    aiSummary:
      "Ingests raw JSON event payloads from the external API staging layer with minimal transformation for downstream parsing.",
    createdBy: { initials: "LR", name: "Lena Rodriguez" },
    createdAt: "28 Mar 2026 - 16:18",
    relativeTime: "66d ago",
  },
  {
    id: "mapping-5",
    index: 5,
    name: "FACT_PAYMENTS_RECON",
    qualifiedName: "ENTERPRISE_DWH.DWH_FINANCE.FACT_PAYMENTS",
    status: "Partial",
    projectId: "finance-dwh",
    projectName: "Finance DWH",
    aiSummary:
      "Reconciles payment transactions from FIN_CORE with currency conversion using daily exchange rates.",
    createdBy: { initials: "JT", name: "James Turner" },
    createdAt: "20 Mar 2026 - 10:02",
    relativeTime: "74d ago",
  },
  {
    id: "mapping-6",
    index: 6,
    name: "DIM_PRODUCT_HIERARCHY",
    qualifiedName: "ENTERPRISE_DWH.DWH_SALES.DIM_PRODUCT",
    status: "Complete",
    projectId: "finance-dwh",
    projectName: "Finance DWH",
    aiSummary:
      "Builds product hierarchy levels from reference tables with category rollups and active flag filtering.",
    createdBy: { initials: "PM", name: "Priya Mehta" },
    createdAt: "15 Mar 2026 - 08:55",
    relativeTime: "79d ago",
  },
  {
    id: "mapping-7",
    index: 7,
    name: "CUSTOMER_CONSENT_EVENTS",
    qualifiedName: "CUSTOMER_360.CONSENT.CONSENT_EVENTS",
    status: "Partial",
    projectId: "customer-360",
    projectName: "Customer 360",
    aiSummary:
      "Tracks consent capture and withdrawal events with timezone normalization and channel attribution.",
    createdBy: { initials: "SW", name: "Shane Watson" },
    createdAt: "10 Mar 2026 - 13:30",
    relativeTime: "84d ago",
  },
  {
    id: "mapping-8",
    index: 8,
    name: "INVENTORY_STOCK_SNAPSHOT",
    qualifiedName: "SUPPLY_CHAIN.INVENTORY.STOCK_LEVELS",
    status: "Draft",
    projectId: "product-reporting",
    projectName: "Product Reporting",
    aiSummary:
      "Daily inventory snapshot from warehouse stock levels with SKU enrichment from the product master.",
    createdBy: { initials: "AK", name: "Arjun Kapoor" },
    createdAt: "05 Mar 2026 - 17:44",
    relativeTime: "89d ago",
  },
];
