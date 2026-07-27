name: test_case_patterns
description: Generate appropriate test cases based on transformation rule type with proper edge case coverage and reconciliation patterns.
instructions: |
  Use this skill when generating test cases for STTM mappings, dbt models, or transformation validation.

  ## Test pattern selection by rule_type

  ### Direct
  **Test focus**: Data integrity and completeness
  ```yaml
  tests:
    - not_null  # If source is NOT NULL
    - unique    # If primary key or unique constraint
    - accepted_values  # If enumerated domain
    - relationships    # If foreign key reference
  ```
  **Sample assertions**:
  - Source count equals target count
  - No data loss during transfer
  - Column values match exactly

  ### CAST
  **Test focus**: Type conversion correctness and boundary handling
  ```yaml
  tests:
    - not_null
    - dbt_expectations.expect_column_values_to_be_of_type
    - dbt_utils.expression_is_true  # For range validation
  ```
  **Sample assertions**:
  - Converted values are within expected type bounds
  - No precision loss for numeric conversions
  - Date/timestamp formats are consistent
  - Invalid source values handled gracefully (NULL or error)

  **Edge cases to include**:
  - Maximum/minimum type boundary values
  - NULL source handling
  - Whitespace-only string to number
  - Invalid date formats

  ### COALESCE
  **Test focus**: Fallback logic correctness
  ```yaml
  tests:
    - not_null  # Result should rarely be NULL
    - dbt_utils.expression_is_true  # Priority verification
  ```
  **Sample assertions**:
  - First non-null source used correctly
  - Default value applied when all sources NULL
  - Priority order matches business specification

  **Edge cases to include**:
  - All source columns NULL
  - First source NULL, second has value
  - Empty string vs NULL handling
  - Default value edge cases

  ### Concatenate
  **Test focus**: Assembly correctness and delimiter handling
  ```yaml
  tests:
    - not_null
    - dbt_expectations.expect_column_value_lengths_to_be_between
  ```
  **Sample assertions**:
  - Concatenation order is correct
  - Delimiters placed correctly
  - NULL component handling (omit vs. show "NULL")
  - Result length within target constraints

  **Edge cases to include**:
  - One or more NULL components
  - Empty string components
  - Special characters in source values
  - Maximum length boundary

  ### CASE WHEN
  **Test focus**: Condition coverage and branch correctness
  ```yaml
  tests:
    - accepted_values  # All possible outputs
    - dbt_utils.expression_is_true  # Each branch verified
  ```
  **Sample assertions**:
  - Each condition branch produces expected output
  - ELSE/default case handles unmatched values
  - No overlapping conditions cause ambiguity
  - All documented input values have expected outputs

  **Edge cases to include**:
  - Boundary values between conditions
  - NULL input handling
  - Values not matching any explicit condition
  - Case sensitivity for string comparisons

  ### Custom
  **Test focus**: Expression correctness and business rule validation
  ```yaml
  tests:
    - not_null  # If expected
    - dbt_utils.expression_is_true  # Business rule validation
    - custom_test  # Domain-specific validation
  ```
  **Sample assertions**:
  - Complex expression produces expected results for known inputs
  - Edge cases documented in business requirements are handled
  - Performance is acceptable for large datasets

  **Edge cases to include**:
  - All NULL input combination
  - Division by zero scenarios
  - Overflow/underflow possibilities
  - Domain-specific invalid states

  ## Edge case inclusion guidance

  ### Required edge cases for all rule types
  1. **NULL handling**
     - Source value is NULL
     - Source value is empty string (for strings)
     - Source value is zero (for numbers)

  2. **Boundary conditions**
     - Minimum valid value
     - Maximum valid value
     - Just outside valid range

  3. **Type-specific edges**
     - Strings: empty, whitespace-only, max-length, special characters
     - Numbers: zero, negative, decimal precision limits
     - Dates: leap years, month boundaries, timezone handling
     - Booleans: NULL vs false distinction

  ### Domain-specific edge cases
  Include edge cases based on business context:
  - **Loan amounts**: Zero loans, negative adjustments, currency precision
  - **Dates**: Future dates, historical cutoffs, fiscal year boundaries
  - **Codes**: Deprecated codes, new codes, unknown codes
  - **Percentages**: 0%, 100%, >100% scenarios

  ### Edge case documentation format
  ```yaml
  edge_cases:
    - name: null_source_handling
      input: { source_col: null }
      expected: null  # or default value
      rationale: "NULL sources should propagate as NULL per business rule BR-123"

    - name: max_precision
      input: { amount: 99999999.99999 }
      expected: 99999999.99
      rationale: "Target precision is 2 decimal places, truncation expected"
  ```

  ## Reconciliation pattern usage

  ### Row count reconciliation
  ```sql
  -- Pattern: source_count_matches_target
  select
    (select count(*) from {{ source_table }}) as source_count,
    (select count(*) from {{ target_table }}) as target_count,
    case
      when source_count = target_count then 'PASS'
      else 'FAIL: ' || (source_count - target_count) || ' row difference'
    end as result
  ```
  **Use when**: Direct mappings, no filtering expected

  ### Aggregate reconciliation
  ```sql
  -- Pattern: sum_reconciliation
  select
    sum(source.amount) as source_sum,
    sum(target.amount) as target_sum,
    abs(source_sum - target_sum) as difference,
    case
      when difference < {{ tolerance }} then 'PASS'
      else 'FAIL: difference exceeds tolerance'
    end as result
  from {{ source_table }} source
  full outer join {{ target_table }} target
    on source.key = target.key
  ```
  **Use when**: Numeric aggregates must balance

  ### Key-based reconciliation
  ```sql
  -- Pattern: orphan_detection
  select 'source_orphans' as check_type, count(*) as count
  from {{ source_table }} s
  left join {{ target_table }} t on s.key = t.key
  where t.key is null

  union all

  select 'target_orphans' as check_type, count(*) as count
  from {{ target_table }} t
  left join {{ source_table }} s on t.key = s.key
  where s.key is null
  ```
  **Use when**: Validating join completeness

  ### Value-by-value reconciliation
  ```sql
  -- Pattern: column_value_comparison
  select
    s.key,
    s.{{ column }} as source_value,
    t.{{ column }} as target_value,
    case
      when s.{{ column }} = t.{{ column }} then 'MATCH'
      when s.{{ column }} is null and t.{{ column }} is null then 'MATCH'
      else 'MISMATCH'
    end as comparison
  from {{ source_table }} s
  join {{ target_table }} t on s.key = t.key
  where s.{{ column }} != t.{{ column }}
     or (s.{{ column }} is null) != (t.{{ column }} is null)
  ```
  **Use when**: Detailed value comparison needed

  ### Reconciliation selection guide
  | Scenario | Primary Pattern | Secondary Pattern |
  |----------|-----------------|-------------------|
  | Full load | Row count | Aggregate sum |
  | Incremental | Key-based | Value comparison |
  | Aggregation | Aggregate | Row count of groups |
  | Lookup/join | Key-based | Orphan detection |
  | Complex transform | Value comparison | Sample spot-check |

  ## Test organization

  ### Test file structure
  ```
  tests/
    staging/
      test_stg_<source>__<table>.sql
    intermediate/
      test_int_<domain>__<description>.sql
    reconciliation/
      recon_<source>_to_<target>.sql
  ```

  ### Test naming conventions
  - Unit tests: `test_<model>_<what_is_tested>`
  - Reconciliation: `recon_<source>_to_<target>_<metric>`
  - Edge case: `test_<model>_edge_<scenario>`
