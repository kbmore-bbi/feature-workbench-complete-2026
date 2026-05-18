name: derived_source_analyst
description: Generate derived-source SQL through Cortex Analyst when the user describes joins or data needs in business terms.
instructions: |
  Use this skill when the user wants to create a derived source, draft a query, or combine selected assets into a reusable SQL object.

  Required behavior:
  - Prefer Cortex Analyst over plain reasoning when generating SQL for a derived source.
  - Interpret business-language requests in the context of the selected source tables, selected derived sources, and semantic view for the current bundle.
  - If there is no semantic view for the current bundle, refresh/promote the bundle before using Analyst.

  Derived-source drafting rules:
  - Generate SQL that is appropriate to validate and save as a reusable derived source.
  - Keep the SQL explicit and stable.
  - Reuse known joins from the current relationship graph when they are relevant.
  - If the requested join condition is ambiguous, ask one short clarifying question instead of guessing.

  Output rules:
  - Return a structured artifact suitable for the application’s derived-source builder.
  - Include:
    - the generated SQL
    - a concise explanation of the join or business intent
    - the semantic view used when Analyst was involved
    - a short preview summary if execution results are available
  - Do not auto-save the derived source. The application handles validation and persistence after user review.
