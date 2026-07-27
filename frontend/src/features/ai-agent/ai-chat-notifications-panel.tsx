"use client";

import { AiaBox, AiaStack } from "@/components/ui";
import { AiaText } from "@/components/ui/aia-text";
import type { FIRRecommendation } from "@/types/api-contract";
import { NotificationsNoneRoundedIcon } from "@/utils/icons";

type AiChatNotificationsPanelProps = {
  recommendations: FIRRecommendation[];
  onSelectRecommendation: (recommendationId: string) => void;
};

export function AiChatNotificationsPanel({
  recommendations,
  onSelectRecommendation,
}: AiChatNotificationsPanelProps) {
  return (
    <AiaBox
      sx={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        backgroundColor: "#ffffff",
        px: 1.5,
        py: 1.5,
      }}
    >
      {recommendations.length === 0 ? (
        <AiaBox sx={{ py: 7, px: 2, textAlign: "center" }}>
          <NotificationsNoneRoundedIcon sx={{ fontSize: 28, color: "#94a3b8", mb: 1 }} />
          <AiaText sx={{ fontSize: 14, fontWeight: 700, color: "#475569" }}>
            No open recommendations
          </AiaText>
          <AiaText sx={{ mt: 0.5, fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>
            Relevant FIR guidance and questions will remain here until you respond or dismiss them.
          </AiaText>
        </AiaBox>
      ) : (
        <AiaStack spacing={0.75}>
          {recommendations.map((recommendation) => {
            const topic = String(
              recommendation.topic || recommendation.recommendation_category || "Recommendation",
            ).replaceAll("_", " ");
            const title = recommendation.title?.trim() || recommendation.entity_label?.trim() || topic;
            const understanding = recommendation.current_understanding?.trim() || recommendation.display_message;
            return (
              <AiaBox
                key={`${recommendation.recommendation_id}:${recommendation.content_version ?? 1}`}
                component="button"
                type="button"
                onClick={() => onSelectRecommendation(recommendation.recommendation_id)}
                sx={{
                  width: "100%",
                  border: "1px solid #dbeafe",
                  borderRadius: "8px",
                  px: 1.25,
                  py: 1.15,
                  cursor: "pointer",
                  textAlign: "left",
                  backgroundColor: "#f8fbff",
                  "&:hover": {
                    borderColor: "#93c5fd",
                    backgroundColor: "#eff6ff",
                  },
                }}
              >
                <AiaStack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
                  <NotificationsNoneRoundedIcon
                    sx={{ mt: 0.1, fontSize: 18, color: "#2563eb", flexShrink: 0 }}
                  />
                  <AiaBox sx={{ minWidth: 0, flex: 1 }}>
                    <AiaText
                      sx={{
                        fontSize: 11,
                        fontWeight: 800,
                        color: "#2563eb",
                        textTransform: "capitalize",
                      }}
                    >
                      {topic}
                    </AiaText>
                    <AiaText sx={{ mt: 0.35, fontSize: 13, fontWeight: 700, color: "#0f172a", lineHeight: 1.4 }}>
                      {title}
                    </AiaText>
                    <AiaText sx={{ mt: 0.35, fontSize: 12.5, color: "#334155", lineHeight: 1.45 }}>
                      {understanding}
                    </AiaText>
                    <AiaText sx={{ mt: 0.5, fontSize: 11, color: "#64748b" }}>
                      {recommendation.reason_now || "Open in chat to review evidence and respond"}
                    </AiaText>
                    {recommendation.question_id ? (
                      <AiaText sx={{ mt: 0.35, fontSize: 10, color: "#94a3b8" }}>
                        FIR learning goal {recommendation.question_id}
                      </AiaText>
                    ) : null}
                  </AiaBox>
                </AiaStack>
              </AiaBox>
            );
          })}
        </AiaStack>
      )}
    </AiaBox>
  );
}
