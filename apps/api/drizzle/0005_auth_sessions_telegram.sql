CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "telegram_login_replays" (
	"telegram_user_id" text NOT NULL,
	"auth_date" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_login_replays_telegram_user_id_auth_date_pk" PRIMARY KEY("telegram_user_id","auth_date")
);
--> statement-breakpoint
CREATE TABLE "user_identities" (
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_identities_provider_subject_pk" PRIMARY KEY("provider","subject"),
	CONSTRAINT "user_identities_provider_valid" CHECK ("user_identities"."provider" in ('TELEGRAM', 'DEV'))
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_channel_valid";--> statement-breakpoint
DROP INDEX "notifications_pending_idx";--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telegram_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_identities_user_idx" ON "user_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_pending_idx" ON "notifications" USING btree ("channel","created_at") WHERE "notifications"."status" = 'PENDING';--> statement-breakpoint
-- Channels that never had a delivery provider (PUSH/EMAIL/SMS) become in-app inbox entries.
UPDATE "notifications" SET "channel" = 'IN_APP', "status" = 'SENT', "sent_at" = COALESCE("sent_at", "created_at")
	WHERE "channel" NOT IN ('IN_APP', 'TELEGRAM');--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_channel_valid" CHECK ("notifications"."channel" in ('IN_APP', 'TELEGRAM'));