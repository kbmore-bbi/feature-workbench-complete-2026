from pydantic import BaseModel, Field


class TableRef(BaseModel):
    """Fully-qualified reference to a Snowflake table."""

    database: str = Field(description="Snowflake database name.")
    schema: str = Field(description="Snowflake schema name.")
    table: str = Field(description="Table name.")

    @property
    def qualified_name(self) -> str:
        return f"{self.database}.{self.schema}.{self.table}"


class AttributeRef(BaseModel):
    """Reference to a specific column/attribute within a Snowflake table."""

    table: TableRef = Field(description="Table that owns this attribute.")
    attribute: str = Field(description="Column/attribute name.")
