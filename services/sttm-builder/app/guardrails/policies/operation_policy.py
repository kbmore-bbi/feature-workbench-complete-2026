from __future__ import annotations

import re


def is_operation_allowed(allowed_operations: list[str], operation: str) -> bool:
    return "*" in allowed_operations or operation in allowed_operations


def find_forbidden_sql_tokens(sql_text: str, forbidden_patterns: list[str]) -> list[str]:
    upper_sql = sql_text.upper()
    return [
        pattern
        for pattern in forbidden_patterns
        if re.search(rf"\b{re.escape(pattern.upper())}\b", upper_sql)
    ]
