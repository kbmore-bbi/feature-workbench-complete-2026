from app.core.fir_asset_resolver import FIRAssetTableResolver


class _Row:
    def __init__(self, values):
        self._values = values

    def as_dict(self):
        return self._values


class _Collectable:
    def __init__(self, rows):
        self._rows = rows

    def collect(self):
        return self._rows


class _Session:
    def sql(self, statement, params=None):
        if "ACCOUNT_USAGE.TABLES" in statement:
            return _Collectable([])
        return _Collectable(
            [
                _Row(
                    {
                        "DATABASE_NAME": "CLIENT_DB",
                        "SCHEMA_NAME": "RAW",
                        "TABLE_NAME": "CONTACTS",
                        "SEMANTIC_VIEW": {"description": "Client contacts"},
                    }
                )
            ]
        )


class _Settings:
    resolved_semantic_views_table = "FOCUS_DB_2.STTM_MCP.SEM_TABLE_VIEWS"


def test_catalog_accepts_registry_without_optional_status_or_view_id_columns():
    resolver = FIRAssetTableResolver.__new__(FIRAssetTableResolver)
    resolver._session = _Session()
    resolver._settings = _Settings()

    catalog = resolver._catalog()

    assert catalog == [
        {
            "DATABASE_NAME": "CLIENT_DB",
            "SCHEMA_NAME": "RAW",
            "TABLE_NAME": "CONTACTS",
            "SEMANTIC_VIEW": {"description": "Client contacts"},
            "FQN": "CLIENT_DB.RAW.CONTACTS",
            "VIEW_ID": None,
            "STATUS": None,
            "SEMANTIC_AVAILABLE": True,
        }
    ]
