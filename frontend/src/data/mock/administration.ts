export type AdminUserRole = "Admin" | "Publisher" | "Editor" | "Viewer";
export type AdminUserStatus = "Active" | "Locked";

export type AdminUserListItem = {
  id: string;
  initials: string;
  name: string;
  email: string;
  role: AdminUserRole;
  status: AdminUserStatus;
  lastLogin: string;
  mappingsCount: number;
  isPrimaryAdmin?: boolean;
};

export type AuditLogAction =
  | "User Login"
  | "User Created"
  | "User Updated"
  | "User Locked"
  | "User Unlocked"
  | "Mapping Published"
  | "Mapping Edited"
  | "Mapping Created"
  | "Mapping Locked"
  | "Mapping Unlocked"
  | "Ownership Transferred"
  | "Mapping Deleted";

export type AuditLogListItem = {
  id: string;
  timestamp: string;
  user: { initials: string; name: string };
  action: AuditLogAction;
  target: string;
  details: string;
};

export type OwnershipTransferStatus = "Published" | "Draft" | "In Review";

export type OwnershipTransferListItem = {
  id: string;
  mappingName: string;
  owner: { initials: string; name: string };
  projectName: string;
  lastModified: string;
  status: OwnershipTransferStatus;
};

export type MappingLockStatus = "Locked" | "Unlocked";

export type MappingLockListItem = {
  id: string;
  mappingName: string;
  status: MappingLockStatus;
  lockedBy?: string;
  lockedSince?: string;
  activeUsers: Array<{ initials: string; name: string }>;
};

export type ScreenPermissionLevel = "edit" | "view" | "hidden";

export type AdminPersona = "Admin" | "Publisher" | "Editor" | "Viewer";

export type ScreenPermissionItem = {
  id: string;
  title: string;
  description: string;
  permissions: Record<AdminPersona, ScreenPermissionLevel>;
};

export type ScreenPermissionSection = {
  id: string;
  title: string;
  screens: ScreenPermissionItem[];
};

export const MOCK_ADMIN_USERS: AdminUserListItem[] = [
  {
    id: "user-1",
    initials: "SW",
    name: "Shane Watson",
    email: "shane.watson@company.com",
    role: "Admin",
    status: "Active",
    lastLogin: "2026-06-16 09:00",
    mappingsCount: 12,
    isPrimaryAdmin: true,
  },
  {
    id: "user-2",
    initials: "PS",
    name: "Priya Sharma",
    email: "priya.sharma@company.com",
    role: "Publisher",
    status: "Active",
    lastLogin: "2026-06-16 08:42",
    mappingsCount: 8,
  },
  {
    id: "user-3",
    initials: "JL",
    name: "James Liu",
    email: "james.liu@company.com",
    role: "Editor",
    status: "Active",
    lastLogin: "2026-06-15 17:20",
    mappingsCount: 5,
  },
  {
    id: "user-4",
    initials: "CM",
    name: "Carlos Mendez",
    email: "carlos.mendez@company.com",
    role: "Viewer",
    status: "Locked",
    lastLogin: "2026-06-10 11:05",
    mappingsCount: 0,
  },
  {
    id: "user-5",
    initials: "AR",
    name: "Anita Rao",
    email: "anita.rao@company.com",
    role: "Publisher",
    status: "Active",
    lastLogin: "2026-06-16 07:55",
    mappingsCount: 6,
  },
];

export const MOCK_AUDIT_LOG: AuditLogListItem[] = [
  {
    id: "audit-1",
    timestamp: "2026-06-16 09:14",
    user: { initials: "SW", name: "Shane Watson" },
    action: "User Login",
    target: "-",
    details: "Login from 192.168.1.42",
  },
  {
    id: "audit-2",
    timestamp: "2026-06-16 08:58",
    user: { initials: "PS", name: "Priya Sharma" },
    action: "Mapping Published",
    target: "Salesforce Mapping v1",
    details: "Published to DWH.FACT_SALES",
  },
  {
    id: "audit-3",
    timestamp: "2026-06-16 08:31",
    user: { initials: "JL", name: "James Liu" },
    action: "Mapping Edited",
    target: "CRM Migration v2",
    details: "Modified 3 column mappings",
  },
  {
    id: "audit-4",
    timestamp: "2026-06-15 16:44",
    user: { initials: "AR", name: "Anita Rao" },
    action: "Mapping Created",
    target: "API Mapping v5",
    details: "Created from CRM source tables",
  },
  {
    id: "audit-5",
    timestamp: "2026-06-15 14:10",
    user: { initials: "SW", name: "Shane Watson" },
    action: "Ownership Transferred",
    target: "HR Data Sync",
    details: "Transferred from Carlos Mendez to James Liu",
  },
  {
    id: "audit-6",
    timestamp: "2026-06-15 11:22",
    user: { initials: "SW", name: "Shane Watson" },
    action: "User Locked",
    target: "Carlos Mendez",
    details: "Account locked after failed login attempts",
  },
  {
    id: "audit-7",
    timestamp: "2026-06-14 18:05",
    user: { initials: "PS", name: "Priya Sharma" },
    action: "Mapping Deleted",
    target: "Legacy Orders v1",
    details: "Removed draft mapping from CRM Migration",
  },
];

export const MOCK_OWNERSHIP_TRANSFERS: OwnershipTransferListItem[] = [
  {
    id: "ownership-1",
    mappingName: "Salesforce Mapping v1",
    owner: { initials: "PS", name: "Priya Sharma" },
    projectName: "CRM Migration",
    lastModified: "2026-06-16",
    status: "Published",
  },
  {
    id: "ownership-2",
    mappingName: "CRM Migration v2",
    owner: { initials: "JL", name: "James Liu" },
    projectName: "CRM Migration",
    lastModified: "2026-06-15",
    status: "Draft",
  },
  {
    id: "ownership-3",
    mappingName: "API Mapping v5",
    owner: { initials: "SW", name: "Shane Watson" },
    projectName: "API Integration",
    lastModified: "2026-06-15",
    status: "In Review",
  },
  {
    id: "ownership-4",
    mappingName: "HR Data Sync",
    owner: { initials: "CM", name: "Carlos Mendez" },
    projectName: "HR Analytics",
    lastModified: "2026-06-15",
    status: "Published",
  },
];

export const MOCK_MAPPING_LOCKS: MappingLockListItem[] = [
  {
    id: "lock-1",
    mappingName: "CRM Migration v2",
    status: "Locked",
    lockedBy: "James Liu",
    lockedSince: "14:35",
    activeUsers: [
      { initials: "JL", name: "James Liu" },
      { initials: "PS", name: "Priya Sharma" },
      { initials: "SW", name: "Shane Watson" },
      { initials: "AR", name: "Anita Rao" },
    ],
  },
  {
    id: "lock-2",
    mappingName: "Salesforce Mapping v1",
    status: "Unlocked",
    activeUsers: [{ initials: "PS", name: "Priya Sharma" }],
  },
  {
    id: "lock-3",
    mappingName: "API Mapping v5",
    status: "Locked",
    lockedBy: "Shane Watson",
    lockedSince: "11:08",
    activeUsers: [
      { initials: "SW", name: "Shane Watson" },
      { initials: "JL", name: "James Liu" },
    ],
  },
  {
    id: "lock-4",
    mappingName: "HR Data Sync",
    status: "Unlocked",
    activeUsers: [],
  },
];

const defaultPermissions = (
  edit: ScreenPermissionLevel,
  view: ScreenPermissionLevel,
  hidden: ScreenPermissionLevel,
): Record<AdminPersona, ScreenPermissionLevel> => ({
  Admin: "edit",
  Publisher: edit,
  Editor: view,
  Viewer: hidden,
});

export const MOCK_SCREEN_PERMISSION_SECTIONS: ScreenPermissionSection[] = [
  {
    id: "step-1",
    title: "Step 1 - Select Tables",
    screens: [
      {
        id: "source-table-selection",
        title: "Source Table Selection",
        description: "Select and browse source tables from the data catalog",
        permissions: defaultPermissions("edit", "edit", "view"),
      },
      {
        id: "join-configuration",
        title: "Join Configuration",
        description: "Configure joins between selected source tables",
        permissions: defaultPermissions("edit", "view", "hidden"),
      },
      {
        id: "filter-builder",
        title: "Filter Builder",
        description: "Apply filters, grouping, and sorting on source data",
        permissions: defaultPermissions("edit", "view", "hidden"),
      },
    ],
  },
  {
    id: "step-2",
    title: "Step 2 - Map · Transform · Validate",
    screens: [
      {
        id: "mapping-table",
        title: "Mapping Table",
        description: "Define source-to-target column mappings",
        permissions: defaultPermissions("edit", "edit", "view"),
      },
      {
        id: "transform-rules",
        title: "Transform Rules",
        description: "Configure SQL transform and pre-process rules",
        permissions: defaultPermissions("edit", "view", "hidden"),
      },
      {
        id: "sql-preview",
        title: "SQL Preview Tab",
        description: "Review generated SQL before validation",
        permissions: defaultPermissions("edit", "view", "hidden"),
      },
      {
        id: "data-preview",
        title: "Data Preview Tab",
        description: "Preview sample output from validated SQL",
        permissions: defaultPermissions("edit", "view", "hidden"),
      },
      {
        id: "data-lineage",
        title: "Data Lineage Tab",
        description: "Inspect upstream and downstream lineage",
        permissions: defaultPermissions("view", "view", "hidden"),
      },
      {
        id: "ai-agent",
        title: "AI Agent Panel",
        description: "Chat assistant for mapping suggestions",
        permissions: defaultPermissions("edit", "view", "hidden"),
      },
    ],
  },
  {
    id: "step-3",
    title: "Step 3 - Final Mapping",
    screens: [
      {
        id: "sttm-sheet",
        title: "STTM Sheet",
        description: "Read-only final mapping summary",
        permissions: defaultPermissions("edit", "view", "view"),
      },
      {
        id: "summary-sql",
        title: "SQL Preview",
        description: "Final approved SQL output",
        permissions: defaultPermissions("edit", "view", "view"),
      },
      {
        id: "dbt-conversion",
        title: "DBT Conversion",
        description: "Generate DBT model artifacts",
        permissions: defaultPermissions("edit", "view", "hidden"),
      },
      {
        id: "publish",
        title: "Publish Mapping",
        description: "Publish mapping to target environment",
        permissions: defaultPermissions("edit", "hidden", "hidden"),
      },
      {
        id: "test-cases",
        title: "Test Cases",
        description: "Review generated validation test cases",
        permissions: defaultPermissions("view", "view", "hidden"),
      },
      {
        id: "summary-export",
        title: "Summary Export",
        description: "Download Excel, SQL, or push to Git",
        permissions: defaultPermissions("edit", "view", "hidden"),
      },
    ],
  },
  {
    id: "dashboard-nav",
    title: "Dashboard & Navigation",
    screens: [
      {
        id: "dashboard",
        title: "Dashboard",
        description: "Workbench home and quick stats",
        permissions: defaultPermissions("edit", "view", "view"),
      },
      {
        id: "projects",
        title: "Projects",
        description: "Browse and manage migration projects",
        permissions: defaultPermissions("edit", "view", "view"),
      },
      {
        id: "mappings",
        title: "All Mappings",
        description: "Search and open existing mappings",
        permissions: defaultPermissions("edit", "view", "view"),
      },
      {
        id: "administration",
        title: "Administration",
        description: "Admin tools — users, audit, permissions",
        permissions: {
          Admin: "edit",
          Publisher: "hidden",
          Editor: "hidden",
          Viewer: "hidden",
        },
      },
    ],
  },
];
