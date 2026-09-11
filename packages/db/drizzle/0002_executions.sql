CREATE TYPE "public"."execution_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."log_level" AS ENUM('debug', 'info', 'warning', 'error');--> statement-breakpoint
CREATE TABLE "execution_logs" (
	"execution_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"level" "log_level" NOT NULL,
	"message" text NOT NULL,
	CONSTRAINT "execution_logs_execution_id_seq_pk" PRIMARY KEY("execution_id","seq")
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bot_id" text NOT NULL,
	"bot_name" text NOT NULL,
	"bot_version" text NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"headed" boolean DEFAULT false NOT NULL,
	"status" "execution_status" DEFAULT 'queued' NOT NULL,
	"entity_id" bigint NOT NULL,
	"requested_by" bigint NOT NULL,
	"profile_id" bigint NOT NULL,
	"worker_id" text,
	"heartbeat_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"progress_step" text,
	"progress_percent" integer,
	"message" text,
	"output" jsonb,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "execution_logs" ADD CONSTRAINT "execution_logs_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "execution_logs_at_idx" ON "execution_logs" USING btree ("at");--> statement-breakpoint
CREATE INDEX "executions_entity_recent_idx" ON "executions" USING btree ("entity_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "executions_bot_idx" ON "executions" USING btree ("bot_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "executions_requested_by_idx" ON "executions" USING btree ("requested_by","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "executions_status_idx" ON "executions" USING btree ("status");