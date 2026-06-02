import { Suspense } from "react";
import AllMappingsPage from "@/features/mappings/AllMappingsPage";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AllMappingsPage />
    </Suspense>
  );
}
