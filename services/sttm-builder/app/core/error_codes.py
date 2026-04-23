from enum import Enum


class ErrorCode(str, Enum):
    # --- Generic ---
    INTERNAL_ERROR = "INTERNAL_ERROR"

    # --- Auth ---
    UNAUTHENTICATED = "UNAUTHENTICATED"
    FORBIDDEN = "FORBIDDEN"

    # --- Validation ---
    VALIDATION_ERROR = "VALIDATION_ERROR"

    # --- Resource ---
    NOT_FOUND = "NOT_FOUND"

    # --- Snowflake / Infrastructure ---
    SNOWFLAKE_CONNECTION_ERROR = "SNOWFLAKE_CONNECTION_ERROR"
    SNOWFLAKE_QUERY_ERROR = "SNOWFLAKE_QUERY_ERROR"
    SNOWFLAKE_AGENT_ERROR = "SNOWFLAKE_AGENT_ERROR"
