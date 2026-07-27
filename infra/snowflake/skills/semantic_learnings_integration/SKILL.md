name: semantic_learnings_integration
description: Integrate semantic learnings with mapping decisions, managing when to preserve versus override learnings, and leveraging column disambiguation and domain vocabulary.
instructions: |
  Use this skill when incorporating semantic learnings into mapping suggestions, resolving column ambiguity, or applying domain vocabulary to transformations.

  ## When to preserve learnings vs override

  ### Preserve existing learnings when
  - The learning has high confidence (confidence >= 0.8)
  - Multiple independent sources confirm the same interpretation
  - The learning originated from explicit user feedback
  - The learning is marked as "verified" or "approved"
  - Historical usage patterns consistently support the learning
  - The learning is referenced by downstream mappings or models

  ### Override existing learnings when
  - The user explicitly provides a different interpretation
  - New business documentation contradicts the stored learning
  - The learning confidence is low (confidence < 0.5) and new evidence is stronger
  - The source schema has materially changed since the learning was captured
  - The learning produces incorrect results in testing
  - A subject matter expert provides correction

  ### Merge learnings when
  - New information supplements rather than contradicts existing learning
  - Additional context adds specificity without changing core meaning
  - Multiple valid interpretations exist for different contexts
  - User feedback refines rather than replaces the understanding

  ### Learning update protocol
  1. **Check existing**: Query learning_context for the column/entity
  2. **Evaluate confidence**: Compare existing vs. new evidence strength
  3. **Determine action**: preserve / override / merge
  4. **Document change**: Record what changed and why
  5. **Propagate impact**: Identify affected downstream mappings

  ```
  learning_decision:
    existing_confidence: 0.85
    new_evidence_strength: moderate
    action: preserve
    rationale: "Existing learning from verified user feedback; new inference does not contradict"
  ```

  ## Column disambiguation usage

  ### When disambiguation is needed
  - Column name appears in multiple source tables with different meanings
  - Generic column names (ID, CODE, TYPE, STATUS, AMOUNT, DATE)
  - Abbreviated column names with multiple possible expansions
  - Source and target use the same name with different business meanings

  ### Disambiguation sources (priority order)
  1. **Explicit user selection**: User specified which source column to use
  2. **Learning context**: Prior mappings established the canonical source
  3. **Relationship graph**: Join paths indicate the correct table context
  4. **Domain vocabulary**: Business term definitions clarify meaning
  5. **Schema analysis**: Data types, constraints, and patterns suggest meaning
  6. **Name similarity**: Semantic similarity between column and target names

  ### Disambiguation resolution format
  ```
  disambiguation:
    ambiguous_column: "LOAN_TYPE"
    candidates:
      - table: DL_LOAN_MASTER
        column: LOAN_TYPE
        meaning: "Primary loan classification code"
        confidence: 0.9
        source: learning_context

      - table: DL_LOAN_DETAIL
        column: LOAN_TYPE
        meaning: "Loan type at transaction level"
        confidence: 0.6
        source: schema_analysis

    resolution:
      selected: DL_LOAN_MASTER.LOAN_TYPE
      rationale: "Learning context confirms this is the canonical loan classification"
      needs_user_confirmation: false
  ```

  ### Disambiguation in join contexts
  - When tables are joined, prefer columns from the driving table
  - If the column appears in both tables with same meaning, document which to use
  - If the column has different meanings, require explicit user selection
  - Document the disambiguation decision in the mapping for future reference

  ## Domain vocabulary integration

  ### Vocabulary sources
  - **Client glossary**: Business terms defined by the client
  - **Industry standards**: Common definitions for the domain (lending, finance)
  - **Historical mappings**: Terms used in prior successful mappings
  - **Column descriptions**: Metadata from source/target schemas
  - **User corrections**: Terminology clarified through feedback

  ### Vocabulary application rules

  #### For column interpretation
  When encountering a column name:
  1. Check domain_vocabulary for exact match
  2. Check for partial/fuzzy match on significant terms
  3. Apply the vocabulary definition to inform transformation selection
  4. Document the vocabulary reference in learning_evidence

  #### For transformation logic
  When building transformation rules:
  1. Use vocabulary-defined code mappings when available
  2. Apply vocabulary-specified formatting conventions
  3. Reference vocabulary for valid value sets (accepted_values)
  4. Incorporate vocabulary-defined business rules

  #### For documentation
  When documenting mappings:
  1. Use vocabulary terms in descriptions (not technical column names)
  2. Reference glossary entries for business meaning
  3. Flag terms that may need vocabulary additions

  ### Vocabulary integration format
  ```
  vocabulary_applied:
    term: "Loan Classification Code"
    definition: "Standard code indicating loan type: CONV, FHA, VA, USDA"
    source: client_glossary
    applied_to:
      - column: SOURCE.LOAN_TYPE_CODE
      - transformation: "CASE WHEN mapping using standard codes"
      - validation: "accepted_values test for defined codes"
  ```

  ### Vocabulary conflict resolution
  When vocabulary conflicts exist:
  - Client glossary takes precedence over industry standards
  - Recent definitions take precedence over historical ones
  - User-corrected definitions take precedence over inferred ones
  - Document conflicts and resolution rationale

  ## Semantic context propagation

  ### Context flow through mapping phases

  #### Source selection phase
  - Capture table-level semantics (purpose, business entity)
  - Record relationship semantics (how tables relate)
  - Store join key interpretations

  #### Mapping phase
  - Apply column-level learnings to suggestions
  - Use domain vocabulary for transformation patterns
  - Disambiguate using accumulated context

  #### Validation phase
  - Verify transformations against semantic expectations
  - Check that vocabulary constraints are satisfied
  - Validate business rule compliance

  ### Context inheritance rules
  - Derived sources inherit semantics from their source tables
  - Joined tables combine semantics with explicit conflict resolution
  - Target columns inherit relevant source column semantics
  - Transformations document semantic modifications

  ## Learning feedback loop

  ### Capturing new learnings
  When a mapping is confirmed or corrected:
  1. Extract the semantic interpretation used
  2. Record confidence based on feedback type
  3. Store column-level and relationship-level learnings
  4. Update domain vocabulary if new terms emerged
  5. Propagate to similar unmapped columns

  ### Learning confidence adjustment
  ```
  confidence_factors:
    user_explicit_confirmation: +0.3
    user_explicit_correction: reset to 0.9 (new value)
    successful_test_execution: +0.1
    consistent_with_prior_learning: +0.1
    contradicts_prior_learning: -0.2
    inferred_from_schema_only: base 0.5
    matched_historical_sql: +0.2
  ```

  ### Learning expiration
  - Learnings without recent usage decrease in confidence over time
  - Schema changes trigger learning review
  - Major version changes require learning revalidation
  - Expired learnings are archived, not deleted
