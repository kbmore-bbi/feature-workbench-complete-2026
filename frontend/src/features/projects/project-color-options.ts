export type ProjectColorOption = {
  id: string;
  label: string;
  color: string;
  bg: string;
};

export const PROJECT_COLOR_OPTIONS: ProjectColorOption[] = [
  { id: "violet", label: "Blue-Violet", color: "#6366F1", bg: "#EEF2FF" },
  { id: "blue", label: "Sky Blue", color: "#2563EB", bg: "#DBEAFE" },
  { id: "green", label: "Green", color: "#059669", bg: "#D1FAE5" },
  { id: "orange", label: "Orange", color: "#EA580C", bg: "#FFEDD5" },
  { id: "red", label: "Red", color: "#DC2626", bg: "#FEE2E2" },
  { id: "purple", label: "Purple", color: "#9333EA", bg: "#F3E8FF" },
  { id: "pink", label: "Pink", color: "#DB2777", bg: "#FCE7F3" },
  { id: "teal", label: "Teal", color: "#0D9488", bg: "#CCFBF1" },
];

export const DEFAULT_PROJECT_COLOR_ID = "orange";

export function getProjectColorById(colorId: string): ProjectColorOption {
  return (
    PROJECT_COLOR_OPTIONS.find((option) => option.id === colorId) ??
    PROJECT_COLOR_OPTIONS.find((option) => option.id === DEFAULT_PROJECT_COLOR_ID)!
  );
}
