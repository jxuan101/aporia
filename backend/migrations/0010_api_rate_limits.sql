CREATE TABLE "api_rate_limit_counters" (
    "rate_key" text NOT NULL,
    "window_seconds" integer NOT NULL,
    "window_started_at" timestamp with time zone NOT NULL,
    "request_count" integer NOT NULL,
    CONSTRAINT "api_rate_limit_counters_pk"
        PRIMARY KEY ("rate_key", "window_seconds"),
    CONSTRAINT "api_rate_limit_window_check"
        CHECK ("window_seconds" > 0),
    CONSTRAINT "api_rate_limit_count_check"
        CHECK ("request_count" > 0)
);
--> statement-breakpoint
CREATE INDEX "api_rate_limit_counters_started_idx"
    ON "api_rate_limit_counters" ("window_started_at");
