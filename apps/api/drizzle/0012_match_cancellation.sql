ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_valid";--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "cancelled_by" uuid;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_valid" CHECK ("notifications"."type" in ('PAYMENT_CONFIRMED', 'PAYMENT_REJECTED', 'PAYMENT_REFUNDED', 'PARTICIPATION_CONFIRMED', 'ORGANIZER_APPROVED', 'ORGANIZER_REJECTED', 'MATCH_CHANGED', 'MATCH_CANCELLED'));