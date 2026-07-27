name: dbt_conversion_patterns
description: Match transformation patterns to dbt macros and organize models according to layer conventions.
instructions: |
  Use this skill when converting STTM mappings to dbt models, selecting appropriate macros, or organizing models within the dbt project structure.

  ## Pattern matching for similar conversions

  Before generating dbt code, search for similar patterns in the existing project:

  ### Pattern search hierarchy
  1. **Exact target match**: Check if the same target table has existing dbt models
  2. **Similar source combination**: Look for models using the same source table set
  3. **Transformation pattern match**: Find models with similar rule types (CASE WHEN, COALESCE, etc.)
  4. **Domain pattern match**: Search for models in the same business domain (loans, amounts, dates)

  ### Pattern matching criteria
  - Source table names and aliases
  - Join patterns and relationship types
  - Transformation complexity (simple cast vs. complex expression)
  - Target column data types and constraints
  - Historical dbt model naming conventions in the project

  ### When patterns conflict
  - Prefer the most recent pattern if multiple exist
  - Favor patterns with passing tests over untested patterns
  - Choose patterns from the same business domain when available
  - Document when deviating from an existing pattern and why

  ## Macro selection from usage patterns

  ### Standard transformation macros
  Select macros based on transformation rule type:

  | Rule Type | Primary Macro | When to Use |
  |-----------|---------------|-------------|
  | Direct | `{{ source() }}` | Simple column reference |
  | CAST | `{{ safe_cast() }}` | Type conversion with null safety |
  | COALESCE | `{{ coalesce_columns() }}` | Multi-column fallback |
  | Concatenate | `{{ concat_ws() }}` | Delimiter-separated concat |
  | CASE WHEN | `{{ case_when() }}` | Conditional mapping |
  | Custom | Inline SQL | Complex expressions |

  ### Utility macros by pattern
  - **Null handling**: `{{ default_null() }}`, `{{ nvl2() }}`
  - **Date formatting**: `{{ date_format() }}`, `{{ to_timestamp() }}`
  - **String operations**: `{{ trim_and_upper() }}`, `{{ clean_string() }}`
  - **Numeric precision**: `{{ round_decimal() }}`, `{{ safe_divide() }}`
  - **Code translation**: `{{ map_codes() }}`, `{{ lookup_reference() }}`

  ### Macro selection rules
  - Check project macros directory first for client-specific macros
  - Prefer project macros over dbt-utils when functionality overlaps
  - Use dbt-utils macros for standard operations not in project macros
  - Create inline SQL only when no suitable macro exists
  - Document macro dependencies in model YAML

  ## Layer organization guidance

  ### Layer structure
  Organize dbt models according to the standard layer pattern:

  #### staging (stg_)
  - One model per source table
  - Light transformations only: renaming, casting, basic cleaning
  - No business logic or joins
  - Source freshness tests belong here
  - Naming: `stg_<source_system>__<table_name>.sql`

  #### intermediate (int_)
  - Complex transformations and joins
  - Business logic application
  - Derived calculations
  - May reference multiple staging models
  - Naming: `int_<domain>__<description>.sql`

  #### marts (fct_, dim_)
  - Final business-ready tables
  - Star schema patterns
  - Fact tables: `fct_<business_event>.sql`
  - Dimension tables: `dim_<entity>.sql`
  - Aggregations and metrics

  ### Layer assignment rules
  - **Direct mappings** with no joins: staging layer
  - **Single-source transformations**: staging or intermediate based on complexity
  - **Multi-source joins**: intermediate layer
  - **Target tables for reporting**: marts layer
  - **Derived sources**: intermediate layer as reusable CTEs or models

  ### Cross-layer dependencies
  - staging models reference only sources
  - intermediate models reference staging and other intermediate
  - marts reference intermediate (prefer) or staging
  - Never reference raw source tables from marts
  - Document ref() dependencies in model config

  ## Model generation conventions

  ### File structure
  ```sql
  {{
    config(
      materialized='<type>',
      schema='<layer>',
      tags=['<domain>', '<source_system>']
    )
  }}

  {# Model description and source reference #}
  -- Source: <STTM reference>
  -- Target: <target_table_name>

  with source as (
      select * from {{ ref('stg_<source>') }}
  ),

  transformed as (
      -- Transformation logic here
  )

  select * from transformed
  ```

  ### Materialization selection
  - **view**: Small dimension tables, frequently changing logic
  - **table**: Large fact tables, complex transformations
  - **incremental**: High-volume tables with clear timestamp/ID partitioning
  - **ephemeral**: Reusable CTEs that should not persist

  ### Documentation requirements
  - Model description in schema.yml
  - Column descriptions for all business-meaningful columns
  - Test definitions for primary keys and relationships
  - Source lineage comments in SQL
