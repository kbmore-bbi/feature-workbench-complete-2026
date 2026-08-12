import SummaryPage from "../../new/summary/page";
import { SavedSttmLoader } from "@/features/sttm/shared/saved-sttm-loader";

export default function SavedSummaryPage() {
  return (
    <SavedSttmLoader>
      <SummaryPage />
    </SavedSttmLoader>
  );
}
