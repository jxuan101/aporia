ALTER TABLE "agent_jobs"
    DROP CONSTRAINT "agent_jobs_capture_revision_unique";
--> statement-breakpoint
CREATE INDEX "agent_jobs_capture_revision_created_idx"
    ON "agent_jobs" ("user_id", "capture_id", "capture_revision", "created_at" DESC);
