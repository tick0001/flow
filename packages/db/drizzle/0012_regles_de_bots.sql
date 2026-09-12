CREATE TABLE "bot_rules" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bot_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"bot_id" text NOT NULL,
	"entity_id" bigint NOT NULL,
	"is_recursive" boolean DEFAULT true NOT NULL,
	"profile_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_rules" ADD CONSTRAINT "bot_rules_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_rules" ADD CONSTRAINT "bot_rules_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bot_rules_unique" ON "bot_rules" USING btree ("bot_id","entity_id","profile_id");--> statement-breakpoint
CREATE INDEX "bot_rules_bot_idx" ON "bot_rules" USING btree ("bot_id");--> statement-breakpoint
CREATE INDEX "bot_rules_entity_idx" ON "bot_rules" USING btree ("entity_id");