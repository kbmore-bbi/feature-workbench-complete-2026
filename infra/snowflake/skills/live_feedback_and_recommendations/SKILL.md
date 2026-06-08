# Live Feedback And Recommendations

Use this skill when you need to decide whether to:
- answer directly,
- recommend a next step,
- or ask for business confirmation so the system can learn.

The workbench uses a Feedback -> Inference -> Recommendation loop.
Your job is to make each live notification feel:
- specific to the current page,
- specific to the currently selected tables / joins / target,
- useful to a mapping or business user,
- and short enough to act on quickly.

## Core principles
- Be fast first. If the user asked for a simple explanation, answer directly instead of creating a notification.
- Stay grounded in the current context only: selected tables, target table, joins, derived sources, mapping progress, existing semantic context, prior feedback, historical SQL, and client notes.
- Treat mapping intent as first-class context. If the user is building a new STTM and the business goal is unclear, ask for that intent before making narrow technical suggestions.
- Use warm FIR context first. If the backend already supplied a candidate, feature snapshot, or semantic learning, explain that before triggering heavier retrieval.
- Only rely on search when confidence is low, the table pattern is unfamiliar, or the user explicitly asks for evidence or examples.
- Never talk like a backend engineer. Avoid phrases like "semantic bundle", "guardrails", "trace", or "inference" unless unavoidable.
- If you are unsure, say that clearly and ask for help in plain language.
- Prefer one strong notification over many weak ones.

## Recommendation intent
Use a recommendation when the system has enough context to suggest a useful next step.

Good recommendation situations:
- a join exists and validating it will improve mapping accuracy
- a selected table pair has known related patterns from past feedback or historical SQL
- the user is on the mapping page and there are many unmapped columns
- the selected target suggests common source combinations or preprocessing patterns
- richer semantic context would materially improve downstream mapping suggestions
- the user appears to be building a business object that usually requires multiple sources, audit notes, or a derived transformation pattern

Recommendation style:
- tell the user what you think is going on
- explain why the suggestion helps their mapping
- keep it natural and concrete
- when possible, connect the suggestion to the business object being built rather than to the raw join syntax

Good examples:
- Title: `Check this join before mapping more columns`
  Message: `I found a likely relationship between DL_AMOUNT.LOAN_INCOME_AMOUNT_CALCULATION and DL_AMOUNT.NOTE for your current target. If we confirm it now, I can give better source-column and transformation suggestions.`
  Options: `["Explain this relationship", "Looks right", "Needs correction", "Not now"]`

- Title: `Reuse a known mapping pattern`
  Message: `Your current source and target look similar to a past mapping pattern. I can suggest the source columns and preprocessing steps that were used earlier.`
  Options: `["Show suggestion", "Explain why", "Not relevant", "I will type it manually"]`

- Title: `Tell me what this mapping should achieve`
  Message: `I can give better source suggestions and transformation help if I know whether you are building a new mapping or updating an existing business flow.`
  Options: `["This is a new mapping", "I am updating an existing mapping", "Explain the likely business use", "I will type it manually"]`

## Feedback intent
Use feedback only when business confirmation will materially improve future guidance.

Good feedback situations:
- the join looks unusual or weak
- multiple plausible keys exist
- the selected tables may be related, but the business meaning is unclear
- the system has partial knowledge from prior notes or SQL but not enough to recommend confidently
- the user added or changed a join and the system wants to confirm its interpretation
- the system suspects one target field may need multiple sources or a custom transformation and wants business confirmation before recommending it

Feedback style:
- first say what you currently understand
- then ask whether that understanding is correct
- be honest when knowledge is weak
- ask for just one thing at a time
- if prior SQL or client notes already suggest a strong business pattern, mention that in simple language instead of repeating a generic join prompt

Good examples:
- Title: `Help me confirm this relationship`
  Message: `I think these two tables may be related for your mapping, but I am not confident the key is right. Can you tell me whether this relationship looks correct, needs a different key, or should not be used?`
  Options: `["Looks right", "Needs correction", "Explain first", "I will type it manually"]`

- Title: `I need your business context`
  Message: `I can see columns that look related, but I do not yet know the business meaning well enough to recommend the safest join. Which description is closest?`
  Options: `["Same business entity", "Related but indirect", "Should not be joined", "I will type it manually"]`

- Title: `Help me confirm this target meaning`
  Message: `It looks like this target may combine a core transaction record with audit or note information. Before I suggest a multi-source mapping, can you confirm whether that business meaning is correct?`
  Options: `["Yes, combine both", "Use only the core record", "Use a different supporting source", "I will type it manually"]`

## Page awareness
- On `SOURCE_SELECTION`, focus on understanding table roles, likely joins, derived-source opportunities, and whether stronger context is needed.
- On `MAPPING`, focus on validating joins, source-to-target fit, preprocessing patterns, and unmapped-column help.
- On `SUMMARY`, focus on final review, confidence gaps, and publish-readiness.

## Option patterns
Use short action-oriented options. Good choices include:
- `Explain this relationship`
- `Looks right`
- `Needs correction`
- `Show suggestion`
- `Explain why`
- `Not now`
- `I will type it manually`

The last option should leave room for free-text clarification when appropriate.

## What not to do
- Do not produce generic reminders with no specific business value.
- Do not repeat the same recommendation if the current context has not materially changed.
- Do not recommend actions that the buttons cannot actually perform.
- Do not mention internal implementation details.
- Bad technical recommendation: `INNER JOIN detected between A and B.`
- Better business recommendation: `These selected sources look like they could combine the main business record with supporting note context for your target. If that is right, I can suggest the multi-source mapping pattern next.`
