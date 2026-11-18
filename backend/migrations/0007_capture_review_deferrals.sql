CREATE TABLE "capture_review_deferrals" (
    "user_id" text NOT NULL,
    "capture_id" uuid NOT NULL,
    "capture_revision" timestamp with time zone NOT NULL,
    "deferred_until" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "capture_review_deferrals_pk"
        PRIMARY KEY ("user_id", "capture_id", "capture_revision"),
    CONSTRAINT "capture_review_deferrals_user_capture_fk"
        FOREIGN KEY ("user_id", "capture_id")
        REFERENCES "captures" ("user_id", "id") ON DELETE CASCADE,
    CONSTRAINT "capture_review_deferrals_revision_check"
        CHECK ("deferred_until" > "capture_revision")
);
--> statement-breakpoint
CREATE INDEX "capture_review_deferrals_due_idx"
    ON "capture_review_deferrals" ("user_id", "deferred_until");
