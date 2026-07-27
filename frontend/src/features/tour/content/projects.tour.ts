import type { TourDefinition } from "../types/tour.types";
import { TOUR_TARGETS, tourSelector } from "../constants/tour-targets";

export const projectsTour: TourDefinition = {
  id: "projects",
  label: "Projects",
  description: "Browse and manage projects with sidebar navigation.",
  routes: ["/projects"],
  steps: [
    {
      id: "projects-overview",
      screen: "Projects",
      title: "Projects",
      body: "View and manage all projects that contain source-to-target mappings. Use the left sidebar to navigate between Dashboard, Projects, and Mappings.",
      placement: "center",
      route: "/projects",
    },
    {
      id: "projects-sidebar-dashboard",
      screen: "Projects",
      title: "Dashboard",
      body: "Navigates to the main Dashboard view showing overall statistics: Total Projects, Total Mappings, In-progress Mappings, and Published Mappings.",
      target: tourSelector(TOUR_TARGETS.sidebarDashboard),
      placement: "right",
      route: "/projects",
    },
    {
      id: "projects-sidebar-projects",
      screen: "Projects",
      title: "Projects",
      body: "Navigates to the Projects list, where the user can view and manage all projects that contain mappings.",
      target: tourSelector(TOUR_TARGETS.sidebarProjects),
      placement: "right",
      route: "/projects",
    },
    {
      id: "projects-sidebar-mappings",
      screen: "Projects",
      title: "Mappings",
      body: "Navigates to the Mappings list, where the user can browse all mappings across all projects.",
      target: tourSelector(TOUR_TARGETS.sidebarMappings),
      placement: "right",
      route: "/projects",
    },
    {
      id: "projects-new-mapping",
      screen: "Projects",
      title: "New Mapping",
      body: "The primary action button on the Dashboard. Opens the 'New Mapping' modal where the user selects how to create a new source-to-target mapping. The tour guide should highlight this as the starting point for all new mapping workflows.",
      target: tourSelector(TOUR_TARGETS.newMappingButton),
      placement: "right",
      route: "/projects",
    },
    {
      id: "projects-user-profile",
      screen: "Projects",
      title: "User Profile",
      body: "Displays the logged-in user's name and role. Consistent across all screens in the top-right corner.",
      target: tourSelector(TOUR_TARGETS.userProfile),
      placement: "bottom",
      route: "/projects",
    },
  ],
};
