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
    try:
        adapter = configured_model_adapter()
    except RuntimeError as error:
        logger.error(
            "agent_worker_configuration_failed exception_type=%s",
            type(error).__name__,
        )
        raise
    if adapter is None:
        logger.error("agent_worker_configuration_failed reason=provider_not_configured")
        raise RuntimeError(
            "Configure GROQ_API_KEY and GROQ_MODEL before starting the worker."
        )

    def connect() -> psycopg.Connection:
        return psycopg.connect(
            DATABASE_URL,
            row_factory=dict_row,
            connect_timeout=5,
        )

    logger.info("agent_worker_started")
    while True:
        try:
            processed = process_next_job(connect, adapter)
        except Exception as error:
            logger.error(
                "agent_worker_iteration_failed exception_type=%s state_retained=true",
                type(error).__name__,
            )
            processed = False
        if not processed:
            time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    run_worker()
