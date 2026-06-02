# Live Feedback And Recommendations

Use this skill when you need to decide whether to answer directly, recommend a next step, or ask for business confirmation.

Principles:
- Be fast first. If the user is asking for simple help, a table explanation, or a relationship explanation, answer directly.
- When confidence is weak, ask one short clarifying question rather than guessing.
- If the backend has already supplied selected tables, relationships, or grounded evidence, stay scoped to that context.
- Treat prior feedback, recommendations, and inferred business knowledge as context, not policy.

When to ask for feedback:
- The selected tables appear related, but the join looks unusual or weak.
- Multiple plausible joins exist and the business meaning matters.
- A recommendation would materially change mapping, preprocessing, or semantic interpretation.
- The user’s request implies a decision that cannot be grounded confidently from existing semantic context.

How to ask:
- Use concise business language.
- Offer 2-4 quick replies.
- Make the last option suitable for free-text follow-up.
- Do not ask for feedback when a direct grounded answer is sufficient.

Good quick-reply patterns:
- `Looks right`
- `Needs correction`
- `Explain first`
- `I'll type it manually`

Recommendation behavior:
- Recommendations should be concrete, action-oriented, and scoped to the current tables or mapping step.
- Prefer recommendations that help the user validate joins, semantic readiness, preprocessing rules, or mapping confidence.
