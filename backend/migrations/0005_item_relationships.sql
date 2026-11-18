CREATE TABLE "item_relationships" (
    "user_id" text NOT NULL,
    "item_low" uuid NOT NULL,
    "item_high" uuid NOT NULL,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "item_relationships_pair_check" CHECK ("item_low" < "item_high"),
    CONSTRAINT "item_relationships_pair_unique"
        UNIQUE ("user_id", "item_low", "item_high"),
    CONSTRAINT "item_relationships_low_fk" FOREIGN KEY ("user_id", "item_low")
        REFERENCES "items" ("user_id", "id") ON DELETE CASCADE,
    CONSTRAINT "item_relationships_high_fk" FOREIGN KEY ("user_id", "item_high")
        REFERENCES "items" ("user_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "item_relationships_high_idx"
    ON "item_relationships" ("user_id", "item_high", "item_low");
