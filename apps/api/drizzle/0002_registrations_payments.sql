CREATE TABLE "match_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'APPLIED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_registrations_match_user_key" UNIQUE("match_id","user_id"),
	CONSTRAINT "match_registrations_status_valid" CHECK ("match_registrations"."status" in ('APPLIED', 'CONFIRMED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "registration_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"amount_krw" integer NOT NULL,
	"status" text DEFAULT 'AWAITING_PAYMENT' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"receipt_key" text,
	"receipt_content_type" text,
	"receipt_uploaded_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"reject_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registration_payments_registration_id_unique" UNIQUE("registration_id"),
	CONSTRAINT "registration_payments_status_valid" CHECK ("registration_payments"."status" in ('AWAITING_PAYMENT', 'PAYMENT_REVIEW', 'PAYMENT_CONFIRMED', 'PAYMENT_REJECTED', 'REFUNDED')),
	CONSTRAINT "registration_payments_reason_valid" CHECK ("registration_payments"."reject_reason" is null or "registration_payments"."reject_reason" in ('AMOUNT_MISMATCH', 'RECEIPT_UNREADABLE', 'PAYMENT_NOT_FOUND', 'OTHER')),
	CONSTRAINT "registration_payments_amount_positive" CHECK ("registration_payments"."amount_krw" > 0)
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_valid";--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "max_players" smallint DEFAULT 10 NOT NULL;--> statement-breakpoint
UPDATE "matches" SET "max_players" = LEAST(60, GREATEST(6, "players_per_side" * 2));--> statement-breakpoint
ALTER TABLE "match_registrations" ADD CONSTRAINT "match_registrations_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_registrations" ADD CONSTRAINT "match_registrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_payments" ADD CONSTRAINT "registration_payments_registration_id_match_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."match_registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_payments" ADD CONSTRAINT "registration_payments_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_registrations_user_idx" ON "match_registrations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "match_registrations_match_status_idx" ON "match_registrations" USING btree ("match_id","status");--> statement-breakpoint
CREATE INDEX "registration_payments_status_idx" ON "registration_payments" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_max_players_range" CHECK ("matches"."max_players" between 6 and 60);--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_valid" CHECK ("notifications"."type" in ('PAYMENT_CONFIRMED', 'PAYMENT_REJECTED', 'PARTICIPATION_CONFIRMED'));