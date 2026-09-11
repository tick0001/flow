CREATE TABLE "directory_rules" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "directory_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"group_name" "citext" NOT NULL,
	"profile_id" bigint NOT NULL,
	"entity_id" bigint NOT NULL,
	"is_recursive" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "directory_rules" ADD CONSTRAINT "directory_rules_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_rules" ADD CONSTRAINT "directory_rules_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "directory_rules_unique" ON "directory_rules" USING btree ("group_name","profile_id","entity_id");--> statement-breakpoint
CREATE INDEX "directory_rules_group_idx" ON "directory_rules" USING btree ("group_name");