name: transformation_rule_patterns
description: Select the correct transformation rule type and determine when to leverage learning context for evidence-based rule generation.
instructions: |
  Use this skill when deciding which transformation rule type to apply for a source-to-target mapping or when generating transformation logic for an attribute.

  ## Rule type selection guidance

  Choose the appropriate rule type based on source characteristics and target requirements:

  ### Direct
  Use when:
  - Source and target data types are compatible without conversion
  - No null handling or default values are required
  - Single source column maps directly to target
  - Business meaning is preserved without transformation

  ### CAST
  Use when:
  - Data type conversion is required (e.g., VARCHAR to NUMBER, DATE to TIMESTAMP)
  - Precision or scale changes are needed
  - Format standardization is required within compatible type families
  - Source value structure is stable and predictable

  ### COALESCE
  Use when:
  - Multiple source columns provide fallback values
  - Null handling with default values is required
  - Priority ordering among source candidates exists
  - Business rule specifies "use X if available, otherwise Y"

  ### Concatenate
  Use when:
  - Multiple source columns combine into a single target value
  - Delimiter-separated output is required
  - Composite keys or display values are being constructed
  - Order of concatenation has business significance

  ### CASE WHEN
  Use when:
  - Conditional logic determines output value
  - Value translation or code mapping is required
  - Range-based categorization is needed
  - Multiple conditions produce different outputs
  - Default/else handling for unmatched cases is specified

  ### Custom
  Use when:
  - Complex SQL expressions are required
  - Multiple nested functions are involved
  - Business logic exceeds single-pattern capabilities
  - User explicitly provides a SQL fragment
  - Domain-specific functions or UDFs are needed

  ## When to check learning_context

  Always check learning_context before generating a transformation rule when:
  - The source column name appears in column_learnings with prior mappings
  - The target column has documented business rules or domain vocabulary
  - Similar source-target patterns exist in historical mappings
  - The column involves domain-specific terminology (e.g., loan types, rate codes)
  - Prior feedback indicates a preferred transformation approach
  - The client has documented transformation conventions

  Skip learning_context only when:
  - The transformation is trivially obvious (exact name match, same type)
  - The user explicitly provides the complete transformation logic
  - No prior mappings exist for this source/target combination

  ## Output expectations

  Every transformation rule response must include:

  ### learning_evidence
  Document the evidence that informed the rule selection:
  - Prior mappings for this source or target column
  - Domain vocabulary definitions that apply
  - Business rules from client notes or documentation
  - Historical SQL patterns that match this transformation
  - Confidence level (high/medium/low) based on evidence strength

  Example:
  ```
  learning_evidence:
    prior_mappings: 2 similar transformations found
    domain_match: "LOAN_TYPE_CODE uses standard loan classification vocabulary"
    confidence: high
    source: "column_learnings + domain_vocabulary"
  ```

  ### pattern_source
  Indicate where the pattern originated:
  - `inferred`: Derived from column names, types, and context
  - `learning_context`: Found in column_learnings or domain_vocabulary
  - `historical_sql`: Matched from prior client SQL or mapping history
  - `user_specified`: Explicitly provided by the user
  - `hybrid`: Combined multiple sources with stated priority

  Example:
  ```
  pattern_source: learning_context
  pattern_reference: "column_learnings.DL_AMOUNT.LOAN_TYPE_CODE"
  ```

  ## Rule generation guidelines

  - Prefer explicit CAST over implicit type coercion
  - Include null handling unless source is guaranteed NOT NULL
  - Preserve precision and scale for numeric transformations
  - Use TRIM for string sources unless whitespace is meaningful
  - Document any assumptions in rule comments
  - When confidence is low, generate the rule but flag for review
  - If multiple valid approaches exist, recommend the one with strongest learning evidence
