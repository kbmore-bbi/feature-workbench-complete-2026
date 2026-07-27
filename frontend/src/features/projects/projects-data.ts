export type ProjectMappingStatus = "complete" | "partial" | "draft";

export type ProjectPerson = {
  initials: string;
  name: string;
  timestamp: string;
};

export type ProjectItem = {
  id: string;
  name: string;
  description: string;
  themeColor: string;
  themeBg: string;
  themeBorder: string;
  coveragePercent: number;
  coverageBarColor: string;
  totalMappings: number;
  completeCount: number;
  partialCount: number;
  draftCount: number;
  createdBy: ProjectPerson;
  lastModifiedBy: ProjectPerson;
  domain?: string;
  intendedOutcome?: string;
  businessProcess?: string;
  owner?: string;
  linkedProjectIds?: string[];
};
