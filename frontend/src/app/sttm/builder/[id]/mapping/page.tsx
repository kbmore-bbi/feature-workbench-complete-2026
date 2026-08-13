import MappingPage from "../../new/mapping/page";
import { SavedSttmLoader } from "@/features/sttm/shared/saved-sttm-loader";

export default function SavedMappingPage() {
  return (
    <SavedSttmLoader>
      <MappingPage />
    </SavedSttmLoader>
  );
}
