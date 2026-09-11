CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"bot_id" text NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"headed" boolean DEFAULT false NOT NULL,
	"cron" text NOT NULL,
	"timezone" text NOT NULL,
	"entity_id" bigint NOT NULL,
	"owner_id" bigint NOT NULL,
	"profile_id" bigint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" bigint NOT NULL,
	"profile_id" bigint NOT NULL,
	"entity_id" bigint NOT NULL,
	"include_sub_entities" boolean DEFAULT false NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "schedule_id" uuid;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedules_prochaine_idx" ON "schedules" USING btree ("is_active","next_run_at");--> statement-breakpoint
CREATE INDEX "schedules_entity_idx" ON "schedules" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_token_key" ON "api_keys" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_keys_entity_idx" ON "api_keys" USING btree ("entity_id");--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "executions_schedule_idx" ON "executions" USING btree ("schedule_id","created_at" DESC NULLS LAST);