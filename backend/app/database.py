from collections.abc import Callable, Generator

import psycopg
from fastapi import Request
from psycopg.rows import dict_row

from app.config import DATABASE_URL


def get_connection(request: Request) -> Generator[psycopg.Connection, None, None]:
    connection_factory: Callable[[], psycopg.Connection] | None = getattr(
        request.app.state, "connection_factory", None
    )
    if connection_factory is None:

        def connect() -> psycopg.Connection:
            return psycopg.connect(
                DATABASE_URL,
                row_factory=dict_row,
                connect_timeout=5,
            )

        connection_factory = connect

    with connection_factory() as connection:
        yield connection
