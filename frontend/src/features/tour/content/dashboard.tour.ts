import type { TourDefinition } from "../types/tour.types";
import { TOUR_TARGETS, tourSelector } from "../constants/tour-targets";

export const dashboardTour: TourDefinition = {
  id: "dashboard",
  label: "Dashboard",
  description: "Overview of projects and mappings with sidebar navigation.",
  routes: ["/dashboard"],
  steps: [
    {
      id: "dashboard-overview",
      screen: "Screen 2",
      title: "Dashboard Overview",
      body: "After clicking 'Get Started', the user lands on the Dashboard. This screen provides an at-a-glance overview of all projects and mappings — including total counts, completion rates, and a list of recent mappings. The left-side panel allows navigation between Dashboard, Administration, Projects, and Mappings.",
      placement: "center",
      route: "/dashboard",
    },
    {
      id: "dashboard-sidebar-dashboard",
      screen: "Screen 2",
      title: "Dashboard",
      body: "Navigates to the main Dashboard view showing overall statistics: Total Projects, Total Mappings, In-progress Mappings, and Published Mappings.",
      target: tourSelector(TOUR_TARGETS.sidebarDashboard),
      placement: "right",
      route: "/dashboard",
    },
    {
      id: "dashboard-sidebar-administration",
      screen: "Screen 2",
      title: "Administration",
      body: "Opens the Administration area for managing application settings, users, and access.",
      target: tourSelector(TOUR_TARGETS.sidebarAdministration),
      placement: "right",
      route: "/dashboard",
    },
    {
      id: "dashboard-sidebar-projects",
      screen: "Screen 2",
      title: "Projects",
      body: "Navigates to the Projects list, where the user can view and manage all projects that contain mappings.",
      target: tourSelector(TOUR_TARGETS.sidebarProjects),
      placement: "right",
      route: "/dashboard",
    },
    {
      id: "dashboard-sidebar-mappings",
      screen: "Screen 2",
      title: "Mappings",
      body: "Navigates to the Mappings list, where the user can browse all mappings across all projects.",
      target: tourSelector(TOUR_TARGETS.sidebarMappings),
      placement: "right",
      route: "/dashboard",
    },
    {
      id: "dashboard-user-profile",
      screen: "Screen 2",
      title: "User Profile",
      body: "Displays the logged-in user's name and role. Consistent across all screens in the top-right corner.",
      target: tourSelector(TOUR_TARGETS.userProfile),
      placement: "bottom",
      route: "/dashboard",
    },
  ],
};
