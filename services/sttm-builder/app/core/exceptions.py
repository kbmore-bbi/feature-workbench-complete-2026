from app.core.error_codes import ErrorCode


class AppError(Exception):
    """
    Base for every application-level error.

    Subclasses set class-level defaults for `code` and `status_code`.
    Raise with just a message; the class provides the rest:

        raise SnowflakeConnectionError("Could not reach Snowflake")
        raise NotFoundError("Database 'MY_DB' not found")
    """

    code: ErrorCode = ErrorCode.INTERNAL_ERROR
    status_code: int = 500

    def __init__(
        self,
        message: str,
        *,
        details: list[dict] | None = None,
    ) -> None:
        self.message = message
        self.details: list[dict] = details or []
        super().__init__(message)

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(code={self.code!r}, message={self.message!r})"


# ---------------------------------------------------------------------------
# Infrastructure (upstream dependency failures)
# ---------------------------------------------------------------------------

class InfrastructureError(AppError):
    """Upstream system is unavailable or misbehaving."""
    code = ErrorCode.INTERNAL_ERROR
    status_code = 503


class SnowflakeConnectionError(InfrastructureError):
    """Could not establish or authenticate a Snowflake session."""
    code = ErrorCode.SNOWFLAKE_CONNECTION_ERROR


class SnowflakeQueryError(InfrastructureError):
    """Snowflake session was available but the query/proc failed."""
    code = ErrorCode.SNOWFLAKE_QUERY_ERROR
    status_code = 500


class SnowflakeAgentError(InfrastructureError):
    """Cortex Agent call failed or returned an unparseable response."""
    code = ErrorCode.SNOWFLAKE_AGENT_ERROR
    status_code = 502


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

class AuthenticationError(AppError):
    """Request carries no valid identity (missing / expired token)."""
    code = ErrorCode.UNAUTHENTICATED
    status_code = 401


class OAuthTokenExchangeError(AuthenticationError):
    """Snowflake rejected an OAuth authorization-code or refresh exchange."""

    code = ErrorCode.OAUTH_TOKEN_EXCHANGE_FAILED


class AuthorizationError(AppError):
    """Identity is known but lacks permission for the requested resource."""
    code = ErrorCode.FORBIDDEN
    status_code = 403


# ---------------------------------------------------------------------------
# Resource
# ---------------------------------------------------------------------------

class NotFoundError(AppError):
    """Requested resource does not exist."""
    code = ErrorCode.NOT_FOUND
    status_code = 404


class SemanticAssetNotFoundError(NotFoundError):
    """A selected table has not been published to the canonical registry."""

    code = ErrorCode.SEMANTIC_ASSET_NOT_FOUND


class ContextPrecedentUnavailableError(InfrastructureError):
    """An explicitly linked mapping could not be loaded safely."""

    code = ErrorCode.CONTEXT_PRECEDENT_UNAVAILABLE
    status_code = 503


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

class AppValidationError(AppError):
    """
    Business-rule validation failure (distinct from Pydantic request parsing).
    Pass `details` as a list of {"field": ..., "message": ...} dicts.
    """
    code = ErrorCode.VALIDATION_ERROR
    status_code = 422


class AgentPayloadRequiredContextTooLargeError(AppValidationError):
    """The mandatory model-facing request cannot fit the governed payload limit."""

    code = ErrorCode.AGENT_PAYLOAD_REQUIRED_CONTEXT_TOO_LARGE


class SemanticRelationshipInvalidError(AppValidationError):
    """A selected join cannot be represented safely in Cortex Analyst."""

    code = ErrorCode.SEMANTIC_RELATIONSHIP_INVALID
