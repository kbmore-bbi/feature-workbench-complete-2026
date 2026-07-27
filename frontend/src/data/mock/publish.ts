export type PublishProjectItem = {
  id: string;
  name: string;
  mappingCount: number;
  folderColor: string;
  folderBg: string;
};

export const MOCK_PUBLISH_PROJECT_OPTIONS: PublishProjectItem[] = [
  {
    id: "sales-analytics",
    name: "Sales Analytics",
    mappingCount: 4,
    folderColor: "#7C3AED",
    folderBg: "#EDE9FE",
  },
  {
    id: "finance-dwh",
    name: "Finance DWH",
    mappingCount: 7,
    folderColor: "#2563EB",
    folderBg: "#DBEAFE",
  },
  {
    id: "customer-360",
    name: "Customer 360",
    mappingCount: 3,
    folderColor: "#059669",
    folderBg: "#D1FAE5",
  },
];
