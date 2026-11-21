from pathlib import Path
from urllib.parse import urlparse

import psycopg
from psycopg.rows import dict_row

from app.config import DATABASE_URL

MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "migrations"
MIGRATION_TABLE = "aporia_schema_migrations"
LEGACY_MIGRATION_TABLE = "braindump_schema_migrations"
INITIAL_VERSION = "0001_initial"
INITIAL_TABLES = {
    "accounts",
    "captures",
    "sessions",
    "users",
    "verification_tokens",
}


def migrate_database(database_url: str | None = None) -> None:
    url = database_url or DATABASE_URL
    if not url:
        raise RuntimeError("DATABASE_URL must be configured before running migrations.")

    with psycopg.connect(url, row_factory=dict_row, connect_timeout=5) as connection:
        migration_tables = {
            row["table_name"]
            for row in connection.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public'
                    AND table_name = ANY(%s)
                """,
                ([MIGRATION_TABLE, LEGACY_MIGRATION_TABLE],),
            ).fetchall()
        }
        if LEGACY_MIGRATION_TABLE in migration_tables:
            if MIGRATION_TABLE not in migration_tables:
                connection.execute(
                    f"ALTER TABLE {LEGACY_MIGRATION_TABLE} RENAME TO {MIGRATION_TABLE}"
                )
            else:
                connection.execute(
                    f"""
                    INSERT INTO {MIGRATION_TABLE} (version, applied_at)
                    SELECT version, applied_at FROM {LEGACY_MIGRATION_TABLE}
                    ON CONFLICT (version) DO NOTHING
                    """
                )
                connection.execute(f"DROP TABLE {LEGACY_MIGRATION_TABLE}")

        connection.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {MIGRATION_TABLE} (
                version text PRIMARY KEY,
                applied_at timestamp with time zone NOT NULL DEFAULT now()
            )
            """
        )
        existing_tables = connection.execute(
            """
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public'
            """
        ).fetchall()
        table_names = {row["table_name"] for row in existing_tables}

        applied_versions = {
            row["version"]
            for row in connection.execute(
                f"SELECT version FROM {MIGRATION_TABLE}"
            ).fetchall()
        }
        migration_paths = sorted(MIGRATIONS_DIR.glob("*.sql"))

        for migration in migration_paths:
            version = migration.stem
            if version in applied_versions:
                continue

            if version == INITIAL_VERSION and INITIAL_TABLES.issubset(table_names):
                connection.execute(
                    f"INSERT INTO {MIGRATION_TABLE} (version) VALUES (%s)",
                    (version,),
                )
                applied_versions.add(version)
                continue

            if version == INITIAL_VERSION and table_names.intersection(INITIAL_TABLES):
                raise RuntimeError(
                    "The database has a partial Aporia schema; refusing to apply "
                    "the initial migration over existing tables."
                )

            if version != INITIAL_VERSION and INITIAL_VERSION not in applied_versions:
                raise RuntimeError(
                    "The initial Aporia migration must be applied before later "
                    "migrations."
                )

            for statement in migration.read_text(encoding="utf-8").split(
                "--> statement-breakpoint"
            ):
                if statement.strip():
                    connection.execute(statement)
            connection.execute(
                f"INSERT INTO {MIGRATION_TABLE} (version) VALUES (%s)",
                (version,),
            )
            applied_versions.add(version)


def validate_test_database_url(database_url: str) -> None:
    parsed = urlparse(database_url)
    database_name = parsed.path.removeprefix("/")
    if parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise RuntimeError("Integration tests require a local PostgreSQL database.")
    if not database_name.endswith("_test"):
        raise RuntimeError(
            "APORIA_TEST_DATABASE_URL must point to a database ending in _test."
        )


if __name__ == "__main__":
    migrate_database()
    print("Database migrations applied.")
