export type ProjectMappingStatus = 'complete' | 'partial' | 'draft';

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
};

export const INITIAL_PROJECT_ITEMS: ProjectItem[] = [
  {
    id: 'sales-analytics',
    name: 'Sales Analytics',
    description:
      'Unified sales reporting across CRM, orders, and revenue pipelines for the commercial analytics team.',
    themeColor: '#7C3AED',
    themeBg: '#EDE9FE',
    themeBorder: '#7C3AED',
    coveragePercent: 90,
    coverageBarColor: '#7C3AED',
    totalMappings: 2,
    completeCount: 1,
    partialCount: 1,
    draftCount: 0,
    createdBy: {
      initials: 'PM',
      name: 'Priya Mehta',
      timestamp: '01 Mar 2024 · 09:00',
    },
    lastModifiedBy: {
      initials: 'SW',
      name: 'Shane Watson',
      timestamp: '14 Apr 2026 · 09:22',
    },
  },
  {
    id: 'finance-dwh',
    name: 'Finance DWH',
    description:
      'Finance data warehouse mappings for payments, ledger, and reconciliation workflows.',
    themeColor: '#2563EB',
    themeBg: '#DBEAFE',
    themeBorder: '#2563EB',
    coveragePercent: 92,
    coverageBarColor: '#2563EB',
    totalMappings: 3,
    completeCount: 2,
    partialCount: 1,
    draftCount: 0,
    createdBy: {
      initials: 'JT',
      name: 'James Turner',
      timestamp: '12 Feb 2024 · 11:15',
    },
    lastModifiedBy: {
      initials: 'AK',
      name: 'Arjun Kapoor',
      timestamp: '08 Apr 2026 · 14:05',
    },
  },
  {
    id: 'customer-360',
    name: 'Customer 360',
    description:
      'Customer master, profile, and consent mappings for the enterprise Customer 360 initiative.',
    themeColor: '#059669',
    themeBg: '#D1FAE5',
    themeBorder: '#059669',
    coveragePercent: 88,
    coverageBarColor: '#059669',
    totalMappings: 2,
    completeCount: 1,
    partialCount: 1,
    draftCount: 0,
    createdBy: {
      initials: 'SW',
      name: 'Shane Watson',
      timestamp: '20 Jan 2024 · 16:40',
    },
    lastModifiedBy: {
      initials: 'PM',
      name: 'Priya Mehta',
      timestamp: '10 Mar 2026 · 13:30',
    },
  },
  {
    id: 'product-reporting',
    name: 'Product Reporting',
    description:
      'Product hierarchy and inventory snapshot mappings for supply chain reporting.',
    themeColor: '#EA580C',
    themeBg: '#FFEDD5',
    themeBorder: '#EA580C',
    coveragePercent: 30,
    coverageBarColor: '#EA580C',
    totalMappings: 1,
    completeCount: 0,
    partialCount: 0,
    draftCount: 1,
    createdBy: {
      initials: 'LR',
      name: 'Lena Rodriguez',
      timestamp: '05 Mar 2026 · 17:44',
    },
    lastModifiedBy: {
      initials: 'LR',
      name: 'Lena Rodriguez',
      timestamp: '05 Mar 2026 · 17:44',
    },
  },
];

/** @deprecated Use INITIAL_PROJECT_ITEMS with page state instead */
export const PROJECT_ITEMS = INITIAL_PROJECT_ITEMS;

export const PROJECTS_SUMMARY = {
  projectCount: INITIAL_PROJECT_ITEMS.length,
  totalMappings: INITIAL_PROJECT_ITEMS.reduce((sum, project) => sum + project.totalMappings, 0),
  complete: INITIAL_PROJECT_ITEMS.reduce((sum, project) => sum + project.completeCount, 0),
  inProgress: INITIAL_PROJECT_ITEMS.reduce(
    (sum, project) => sum + project.partialCount + project.draftCount,
    0,
  ),
};
