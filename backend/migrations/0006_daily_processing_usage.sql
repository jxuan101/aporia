CREATE TABLE "agent_usage_daily" (
    "user_id" text NOT NULL,
    "usage_date" date NOT NULL,
    "processing_requests" integer NOT NULL DEFAULT 0,
    CONSTRAINT "agent_usage_daily_requests_check" CHECK ("processing_requests" >= 0),
    CONSTRAINT "agent_usage_daily_pk" PRIMARY KEY ("user_id", "usage_date"),
    CONSTRAINT "agent_usage_daily_user_fk" FOREIGN KEY ("user_id")
        REFERENCES "users" ("id") ON DELETE CASCADE
);
