"""PostgreSQL polling worker for queued AI proposal jobs."""

import logging
import time

import psycopg
from psycopg.rows import dict_row

from app.agent_jobs import POLL_INTERVAL_SECONDS, process_next_job
from app.config import DATABASE_URL
from app.model_factory import configured_model_adapter

logger = logging.getLogger("braindump.agent_worker")


def run_worker() -> None:
    adapter = configured_model_adapter()
    if adapter is None:
        raise RuntimeError(
            "Configure GROQ_API_KEY and GROQ_MODEL before starting the worker."
        )

    def connect() -> psycopg.Connection:
        return psycopg.connect(
            DATABASE_URL,
            row_factory=dict_row,
            connect_timeout=5,
        )

    logger.info("Agent worker started.")
    while True:
        try:
            processed = process_next_job(connect, adapter)
        except Exception:
            logger.error("Agent worker iteration failed; job state is retained.")
            processed = False
        if not processed:
            time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    run_worker()
