CREATE TABLE "bank_deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"raw_text" text NOT NULL,
	"amount_krw" integer,
	"status" text NOT NULL,
	"match_method" text,
	"reason" text,
	"matched_registration_id" uuid,
	"received_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_deposits_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "bank_deposits_source_valid" CHECK ("bank_deposits"."source" in ('WEBHOOK', 'TELEGRAM')),
	CONSTRAINT "bank_deposits_status_valid" CHECK ("bank_deposits"."status" in ('MATCHED', 'AMBIGUOUS', 'UNMATCHED', 'IGNORED')),
	CONSTRAINT "bank_deposits_method_valid" CHECK ("bank_deposits"."match_method" is null or "bank_deposits"."match_method" in ('REFERENCE', 'NAME', 'MANUAL')),
	CONSTRAINT "bank_deposits_reason_valid" CHECK ("bank_deposits"."reason" is null or "bank_deposits"."reason" in ('AMOUNT_MISMATCH', 'NO_CANDIDATE', 'MULTIPLE_CANDIDATES', 'STALE_MESSAGE', 'RATE_GUARD', 'STATE_CHANGED', 'NOT_PARSED', 'MANUAL')),
	CONSTRAINT "bank_deposits_matched_consistent" CHECK (("bank_deposits"."status" = 'MATCHED') = ("bank_deposits"."match_method" is not null))
);
--> statement-breakpoint
ALTER TABLE "payment_events" DROP CONSTRAINT "payment_events_event_valid";--> statement-breakpoint
ALTER TABLE "payment_events" ALTER COLUMN "created_at" SET DEFAULT clock_timestamp();--> statement-breakpoint
ALTER TABLE "registration_payments" ADD COLUMN "reference_code" text;--> statement-breakpoint
-- Give payments that are still expected a unique code before the unique index is created.
UPDATE "registration_payments" p SET "reference_code" = lpad(s.rn::text, 4, '0')
	FROM (
		SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS rn
		FROM "registration_payments"
		WHERE "status" IN ('AWAITING_PAYMENT', 'PAYMENT_REVIEW', 'PAYMENT_REJECTED')
	) s WHERE p."id" = s."id";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "depositor_name" text;--> statement-breakpoint
ALTER TABLE "bank_deposits" ADD CONSTRAINT "bank_deposits_matched_registration_id_match_registrations_id_fk" FOREIGN KEY ("matched_registration_id") REFERENCES "public"."match_registrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_deposits" ADD CONSTRAINT "bank_deposits_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_deposits_status_idx" ON "bank_deposits" USING btree ("status","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "registration_payments_active_reference_idx" ON "registration_payments" USING btree ("reference_code") WHERE "registration_payments"."status" in ('AWAITING_PAYMENT', 'PAYMENT_REVIEW', 'PAYMENT_REJECTED');--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_event_valid" CHECK ("payment_events"."event" in ('PAYMENT_CREATED', 'RECEIPT_UPLOADED', 'CONFIRMED', 'REJECTED', 'REFUND_PENDING', 'REFUNDED', 'EXPIRED', 'RECEIPT_ARCHIVED', 'DEPOSIT_MATCHED'));--> statement-breakpoint
ALTER TABLE "registration_payments" ADD CONSTRAINT "registration_payments_reference_format" CHECK ("registration_payments"."reference_code" is null or "registration_payments"."reference_code" ~ '^[0-9]{4}$');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_depositor_name_length" CHECK (char_length("users"."depositor_name") between 1 and 60);