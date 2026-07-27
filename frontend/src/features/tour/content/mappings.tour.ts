import type { TourDefinition } from "../types/tour.types";
import { TOUR_TARGETS, tourSelector } from "../constants/tour-targets";

export const mappingsTour: TourDefinition = {
  id: "mappings",
  label: "Mappings",
  description: "Browse all mappings with sidebar navigation.",
  routes: ["/mappings"],
  steps: [
    {
      id: "mappings-overview",
      screen: "Mappings",
      title: "All Mappings",
      body: "Browse all source-to-target mappings across projects. Use the left sidebar to navigate between Dashboard, Projects, and Mappings.",
      placement: "center",
      route: "/mappings",
    },
    {
      id: "mappings-sidebar-dashboard",
      screen: "Mappings",
      title: "Dashboard",
      body: "Navigates to the main Dashboard view showing overall statistics: Total Projects, Total Mappings, In-progress Mappings, and Published Mappings.",
      target: tourSelector(TOUR_TARGETS.sidebarDashboard),
      placement: "right",
      route: "/mappings",
    },
    {
      id: "mappings-sidebar-projects",
      screen: "Mappings",
      title: "Projects",
      body: "Navigates to the Projects list, where the user can view and manage all projects that contain mappings.",
      target: tourSelector(TOUR_TARGETS.sidebarProjects),
      placement: "right",
      route: "/mappings",
    },
    {
      id: "mappings-sidebar-mappings",
      screen: "Mappings",
      title: "Mappings",
      body: "Navigates to the Mappings list, where the user can browse all mappings across all projects.",
      target: tourSelector(TOUR_TARGETS.sidebarMappings),
      placement: "right",
      route: "/mappings",
    },
    {
      id: "mappings-new-mapping",
      screen: "Mappings",
      title: "New Mapping",
      body: "The primary action button on the Dashboard. Opens the 'New Mapping' modal where the user selects how to create a new source-to-target mapping. The tour guide should highlight this as the starting point for all new mapping workflows.",
      target: tourSelector(TOUR_TARGETS.newMappingButton),
      placement: "right",
      route: "/mappings",
    },
    {
      id: "mappings-user-profile",
      screen: "Mappings",
      title: "User Profile",
      body: "Displays the logged-in user's name and role. Consistent across all screens in the top-right corner.",
      target: tourSelector(TOUR_TARGETS.userProfile),
      placement: "bottom",
      route: "/mappings",
    },
  ],
};
