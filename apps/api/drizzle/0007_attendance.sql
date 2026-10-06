ALTER TABLE "match_registrations" ADD COLUMN "attended" boolean;--> statement-breakpoint
ALTER TABLE "match_registrations" ADD COLUMN "attendance_marked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "match_registrations" ADD COLUMN "attendance_marked_by" uuid;--> statement-breakpoint
ALTER TABLE "match_registrations" ADD CONSTRAINT "match_registrations_attendance_marked_by_users_id_fk" FOREIGN KEY ("attendance_marked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_registrations_attended_idx" ON "match_registrations" USING btree ("user_id") WHERE "match_registrations"."attended" is not null;--> statement-breakpoint
ALTER TABLE "match_registrations" ADD CONSTRAINT "match_registrations_attendance_confirmed_only" CHECK ("match_registrations"."attended" is null or "match_registrations"."status" = 'CONFIRMED');