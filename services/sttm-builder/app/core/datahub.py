import logging
from collections.abc import Sequence

import httpx

from app.core.config import Settings
from app.schema.common import TableRef

logger = logging.getLogger(__name__)


class DataHubAdapter:
    """Read-only metadata enrichment for selected assets."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def build_context(
        self,
        *,
        source_tables: Sequence[TableRef],
        derived_source_ids: Sequence[str],
    ) -> dict[str, object] | None:
        if not self._settings.datahub_enabled or not self._settings.datahub_graphql_url.strip():
            return None

        urns = [self._dataset_urn(table) for table in source_tables]
        if not urns:
            return None

        headers = {"Content-Type": "application/json"}
        if self._settings.datahub_token.strip():
            headers["Authorization"] = f"Bearer {self._settings.datahub_token.strip()}"

        query, variables = self._dataset_context_query(urns)

        try:
            with httpx.Client(timeout=self._settings.datahub_timeout_seconds) as client:
                response = client.post(
                    self._settings.datahub_graphql_url,
                    headers=headers,
                    json={"query": query, "variables": variables},
                )
                response.raise_for_status()
                payload = response.json()
        except Exception as exc:  # pragma: no cover - graceful fallback path
            logger.warning("DataHub enrichment skipped after request failure: %s", exc)
            return {
                "status": "unavailable",
                "derived_source_ids": list(derived_source_ids),
            }

        data = payload.get("data") or {}
        datasets = [
            data.get(alias)
            for alias in self._dataset_context_aliases(len(urns))
            if data.get(alias) is not None
        ]
        enriched = []
        for item in datasets:
            if not isinstance(item, dict):
                continue
            properties = item.get("properties") or {}
            ownership = ((item.get("ownership") or {}).get("owners")) or []
            tags = ((item.get("globalTags") or {}).get("tags")) or []
            terms = ((item.get("glossaryTerms") or {}).get("terms")) or []
            domain = ((item.get("domain") or {}).get("domain")) or {}
            enriched.append(
                {
                    "urn": item.get("urn"),
                    "name": properties.get("name"),
                    "description": properties.get("description"),
                    "owners": [
                        ((owner.get("owner") or {}).get("username"))
                        for owner in ownership
                        if isinstance(owner, dict)
                    ],
                    "tag_urns": [
                        ((tag.get("tag") or {}).get("urn"))
                        for tag in tags
                        if isinstance(tag, dict)
                    ],
                    "term_urns": [
                        ((term.get("term") or {}).get("urn"))
                        for term in terms
                        if isinstance(term, dict)
                    ],
                    "domain_urn": domain.get("urn"),
                }
            )

        return {
            "status": "available",
            "datasets": enriched,
            "derived_source_ids": list(derived_source_ids),
            "ui_url": self._settings.datahub_ui_url or None,
        }

    @staticmethod
    def _dataset_context_aliases(count: int) -> list[str]:
        return [f"dataset_{index}" for index in range(count)]

    def _dataset_context_query(self, urns: Sequence[str]) -> tuple[str, dict[str, str]]:
        aliases = self._dataset_context_aliases(len(urns))
        body_lines = []
        variables: dict[str, str] = {}
        for alias, urn in zip(aliases, urns, strict=False):
            variable_name = f"{alias}_urn"
            variables[variable_name] = urn
            body_lines.append(
                f"""
                {alias}: dataset(urn: ${variable_name}) {{
                  urn
                  properties {{ name description }}
                  ownership {{ owners {{ owner {{ ... on CorpUser {{ username }} }} }} }}
                  globalTags {{ tags {{ tag {{ urn }} }} }}
                  glossaryTerms {{ terms {{ term {{ urn }} }} }}
                  domain {{ domain {{ urn }} }}
                }}
                """.strip()
            )
        variable_defs = ", ".join(f"${name}: String!" for name in variables)
        body = "\n".join(body_lines)
        query = f"query BatchDatasetContext({variable_defs}) {{\n{body}\n}}"
        return query, variables

    def _dataset_urn(self, table: TableRef) -> str:
        return (
            "urn:li:dataset:(urn:li:dataPlatform:snowflake,"
            f"{table.database}.{table.schema}.{table.table},"
            f"{self._settings.datahub_dataset_env.strip() or 'PROD'})"
        )
