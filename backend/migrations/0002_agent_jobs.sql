ALTER TABLE "captures" ADD CONSTRAINT "captures_user_id_id_unique"
    UNIQUE ("user_id", "id");
--> statement-breakpoint
CREATE TABLE "agent_jobs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" text NOT NULL,
    "capture_id" uuid NOT NULL,
    "capture_revision" timestamp with time zone NOT NULL,
    "status" text NOT NULL DEFAULT 'queued',
    "attempt_count" integer NOT NULL DEFAULT 0,
    "max_attempts" integer NOT NULL DEFAULT 3,
    "available_at" timestamp with time zone NOT NULL DEFAULT now(),
    "locked_until" timestamp with time zone,
    "error_code" text,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "agent_jobs_status_check" CHECK (
        "status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')
    ),
    CONSTRAINT "agent_jobs_attempt_count_check" CHECK (
        "attempt_count" >= 0 AND "max_attempts" BETWEEN 1 AND 5
    ),
    CONSTRAINT "agent_jobs_user_id_id_unique" UNIQUE ("user_id", "id"),
    CONSTRAINT "agent_jobs_capture_revision_unique"
        UNIQUE ("capture_id", "capture_revision"),
    CONSTRAINT "agent_jobs_user_fk" FOREIGN KEY ("user_id")
        REFERENCES "users" ("id") ON DELETE CASCADE,
    CONSTRAINT "agent_jobs_capture_fk" FOREIGN KEY ("user_id", "capture_id")
        REFERENCES "captures" ("user_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "agent_jobs_claim_idx"
    ON "agent_jobs" ("status", "available_at", "created_at");
--> statement-breakpoint
CREATE INDEX "agent_jobs_user_created_idx"
    ON "agent_jobs" ("user_id", "created_at" DESC);
--> statement-breakpoint
CREATE TABLE "agent_suggestions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "job_id" uuid NOT NULL,
    "user_id" text NOT NULL,
    "capture_id" uuid NOT NULL,
    "schema_version" text NOT NULL,
    "payload_json" jsonb NOT NULL,
    "model_identifier" text NOT NULL,
    "prompt_version" text NOT NULL,
    "status" text NOT NULL DEFAULT 'pending',
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "agent_suggestions_status_check" CHECK ("status" = 'pending'),
    CONSTRAINT "agent_suggestions_job_id_unique" UNIQUE ("job_id"),
    CONSTRAINT "agent_suggestions_user_id_id_unique" UNIQUE ("user_id", "id"),
    CONSTRAINT "agent_suggestions_job_fk" FOREIGN KEY ("user_id", "job_id")
        REFERENCES "agent_jobs" ("user_id", "id") ON DELETE CASCADE,
    CONSTRAINT "agent_suggestions_capture_fk" FOREIGN KEY ("user_id", "capture_id")
        REFERENCES "captures" ("user_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "agent_suggestions_user_status_created_idx"
    ON "agent_suggestions" ("user_id", "status", "created_at" DESC);
