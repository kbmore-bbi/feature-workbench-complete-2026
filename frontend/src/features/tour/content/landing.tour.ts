import type { TourDefinition } from "../types/tour.types";
import { TOUR_TARGETS, tourSelector } from "../constants/tour-targets";

export const landingTour: TourDefinition = {
  id: "landing",
  label: "Home Page",
  description: "Introduction after login — get started and user profile.",
  routes: ["/landing", "/home", "/"],
  steps: [
    {
      id: "landing-welcome",
      screen: "Screen 1",
      title: "Welcome to AIA Migration Workbench",
      body: "This is the first screen that user sees after logging into the application. It confirms successful authentication and provides access to the core module of the AIA migration workbench. The username and role assigned are visible in the top corner.",
      placement: "center",
    },
    {
      id: "landing-get-started",
      screen: "Screen 1",
      title: "Get Started",
      body: "Click on Get started to navigate to Dashboard.",
      target: tourSelector(TOUR_TARGETS.landingGetStarted),
      placement: "top",
    },
    {
      id: "landing-user-profile",
      screen: "Screen 1",
      title: "User Profile",
      body: "Displays the logged in username and assigned role (eg Publisher). Appears consistently in the top right corner across all the systems.",
      target: tourSelector(TOUR_TARGETS.userProfile),
      placement: "bottom",
    },
  ],
};
