CREATE INDEX "captures_search_idx" ON "captures" USING GIN (
    to_tsvector('english', "raw_text" || ' ' || "current_text")
);
--> statement-breakpoint
CREATE INDEX "items_search_idx" ON "items" USING GIN (
    to_tsvector(
        'english',
        "title" || ' ' || "summary" || ' ' || "labels_json"::text || ' '
            || "candidate_tasks_json"::text
    )
);
