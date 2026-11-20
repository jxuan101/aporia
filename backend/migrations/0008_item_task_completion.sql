ALTER TABLE "items"
    ADD COLUMN "completed_task_indexes_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD CONSTRAINT "items_completed_task_indexes_array_check"
        CHECK (jsonb_typeof("completed_task_indexes_json") = 'array');
