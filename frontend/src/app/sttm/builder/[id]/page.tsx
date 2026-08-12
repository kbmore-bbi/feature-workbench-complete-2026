import SttmBuilderPage from "../new/page";
import { SavedSttmLoader } from "@/features/sttm/shared/saved-sttm-loader";

export default function SavedSourceTargetPage() {
  return (
    <SavedSttmLoader>
      <SttmBuilderPage />
    </SavedSttmLoader>
  );
}
