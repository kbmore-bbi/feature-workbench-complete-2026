import { MOCK_ALL_MAPPINGS } from "./mappings";
import { MOCK_PROJECT_ITEMS } from "./projects";

export type DashboardStatItem = {
  label: string;
  value: number;
};

export type RecentMappingItem = {
  id: string;
  title: string;
  createdOn: string;
};

export const MOCK_DASHBOARD_STATS: DashboardStatItem[] = [
  {
    label: "Total Projects",
    value: MOCK_PROJECT_ITEMS.length,
  },
  {
    label: "Total Mappings",
    value: MOCK_ALL_MAPPINGS.length,
  },
  {
    label: "In-progress Mappings",
    value: MOCK_ALL_MAPPINGS.filter((item) => item.status !== "Complete").length,
  },
  {
    label: "Published Mappings",
    value: MOCK_ALL_MAPPINGS.filter((item) => item.status === "Complete").length,
  },
];

export const MOCK_RECENT_MAPPINGS: RecentMappingItem[] = MOCK_ALL_MAPPINGS.slice(0, 4).map(
  (item) => ({
    id: item.id,
    title: item.name,
    createdOn: item.createdAt,
  }),
);
