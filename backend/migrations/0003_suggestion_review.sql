ALTER TABLE "agent_suggestions"
    DROP CONSTRAINT "agent_suggestions_status_check";
--> statement-breakpoint
ALTER TABLE "agent_suggestions"
    ADD COLUMN "reviewed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "agent_suggestions"
    ADD COLUMN "accepted_payload_json" jsonb;
--> statement-breakpoint
ALTER TABLE "agent_suggestions"
    ADD CONSTRAINT "agent_suggestions_status_check" CHECK (
        "status" IN ('pending', 'accepted', 'rejected', 'stale')
    );
--> statement-breakpoint
ALTER TABLE "agent_suggestions"
    ADD CONSTRAINT "agent_suggestions_review_state_check" CHECK (
        ("status" = 'pending' AND "reviewed_at" IS NULL
            AND "accepted_payload_json" IS NULL)
        OR ("status" = 'accepted' AND "reviewed_at" IS NOT NULL
            AND "accepted_payload_json" IS NOT NULL)
        OR ("status" IN ('rejected', 'stale') AND "reviewed_at" IS NOT NULL
            AND "accepted_payload_json" IS NULL)
    );
--> statement-breakpoint
CREATE TABLE "items" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" text NOT NULL,
    "capture_id" uuid NOT NULL,
    "suggestion_id" uuid NOT NULL,
    "item_type" text NOT NULL,
    "title" text NOT NULL,
    "summary" text NOT NULL,
    "labels_json" jsonb NOT NULL,
    "candidate_tasks_json" jsonb NOT NULL,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "items_type_check" CHECK (
        "item_type" IN ('task', 'idea', 'note', 'question', 'project', 'reference')
    ),
    CONSTRAINT "items_title_not_blank" CHECK (length(btrim("title")) > 0),
    CONSTRAINT "items_summary_not_blank" CHECK (length(btrim("summary")) > 0),
    CONSTRAINT "items_labels_array_check" CHECK (jsonb_typeof("labels_json") = 'array'),
    CONSTRAINT "items_tasks_array_check"
        CHECK (jsonb_typeof("candidate_tasks_json") = 'array'),
    CONSTRAINT "items_suggestion_id_unique" UNIQUE ("suggestion_id"),
    CONSTRAINT "items_user_id_id_unique" UNIQUE ("user_id", "id"),
    CONSTRAINT "items_capture_fk" FOREIGN KEY ("user_id", "capture_id")
        REFERENCES "captures" ("user_id", "id") ON DELETE CASCADE,
    CONSTRAINT "items_suggestion_fk" FOREIGN KEY ("user_id", "suggestion_id")
        REFERENCES "agent_suggestions" ("user_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "items_user_created_idx" ON "items" ("user_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "items_capture_idx" ON "items" ("user_id", "capture_id");
