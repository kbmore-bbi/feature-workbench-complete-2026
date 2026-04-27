from starlette.requests import Request

from app.auth.extractors.headers import extract_snowflake_context


def _request(headers: dict[str, str]) -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [
            (key.lower().encode("utf-8"), value.encode("utf-8"))
            for key, value in headers.items()
        ],
    }
    return Request(scope)


def test_extract_snowflake_context_reads_ingress_headers() -> None:
    request = _request(
        {
            "Sf-Context-Current-User": "VIEWER_USER",
            "Sf-Context-Current-User-Email": "viewer@example.com",
            "Sf-Context-Current-User-Token": "ingress-user-token",
        }
    )

    context = extract_snowflake_context(request)

    assert context == {
        "snowflake_user": "VIEWER_USER",
        "email": "viewer@example.com",
        "snowflake_user_token": "ingress-user-token",
    }
