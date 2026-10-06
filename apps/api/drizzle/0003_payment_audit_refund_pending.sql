CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"actor_id" uuid,
	"event" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"amount_krw" integer,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_events_event_valid" CHECK ("payment_events"."event" in ('PAYMENT_CREATED', 'RECEIPT_UPLOADED', 'CONFIRMED', 'REJECTED', 'REFUND_PENDING', 'REFUNDED', 'EXPIRED', 'RECEIPT_ARCHIVED'))
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_valid";--> statement-breakpoint
ALTER TABLE "registration_payments" DROP CONSTRAINT "registration_payments_status_valid";--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_events_registration_idx" ON "payment_events" USING btree ("registration_id","created_at");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_valid" CHECK ("notifications"."type" in ('PAYMENT_CONFIRMED', 'PAYMENT_REJECTED', 'PAYMENT_REFUNDED', 'PARTICIPATION_CONFIRMED'));--> statement-breakpoint
ALTER TABLE "registration_payments" ADD CONSTRAINT "registration_payments_status_valid" CHECK ("registration_payments"."status" in ('AWAITING_PAYMENT', 'PAYMENT_REVIEW', 'PAYMENT_CONFIRMED', 'PAYMENT_REJECTED', 'REFUND_PENDING', 'REFUNDED'));--> statement-breakpoint
CREATE FUNCTION payment_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'payment_events is append-only';
END;
$$;--> statement-breakpoint
-- Column-specific on purpose: the actor_id foreign key may still be nulled when a user is deleted.
CREATE TRIGGER payment_events_no_update
	BEFORE UPDATE OF registration_id, event, from_status, to_status, amount_krw, detail, created_at
	ON payment_events FOR EACH ROW EXECUTE FUNCTION payment_events_immutable();--> statement-breakpoint
CREATE TRIGGER payment_events_no_delete
	BEFORE DELETE ON payment_events FOR EACH ROW EXECUTE FUNCTION payment_events_immutable();
