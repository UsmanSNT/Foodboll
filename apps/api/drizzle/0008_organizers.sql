CREATE TABLE "organizer_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"region_id" uuid NOT NULL,
	"message" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizer_applications_status_valid" CHECK ("organizer_applications"."status" in ('PENDING', 'APPROVED', 'REJECTED')),
	CONSTRAINT "organizer_applications_message_length" CHECK (char_length("organizer_applications"."message") <= 500)
);
--> statement-breakpoint
CREATE TABLE "organizer_regions" (
	"user_id" uuid NOT NULL,
	"region_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizer_regions_user_id_region_id_pk" PRIMARY KEY("user_id","region_id")
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_valid";--> statement-breakpoint
ALTER TABLE "organizer_applications" ADD CONSTRAINT "organizer_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_applications" ADD CONSTRAINT "organizer_applications_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_applications" ADD CONSTRAINT "organizer_applications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_regions" ADD CONSTRAINT "organizer_regions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_regions" ADD CONSTRAINT "organizer_regions_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organizer_applications_open_idx" ON "organizer_applications" USING btree ("user_id","region_id") WHERE "organizer_applications"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "organizer_applications_status_idx" ON "organizer_applications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "organizer_regions_region_idx" ON "organizer_regions" USING btree ("region_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_valid" CHECK ("notifications"."type" in ('PAYMENT_CONFIRMED', 'PAYMENT_REJECTED', 'PAYMENT_REFUNDED', 'PARTICIPATION_CONFIRMED', 'ORGANIZER_APPROVED', 'ORGANIZER_REJECTED'));--> statement-breakpoint
-- Organizers that existed before regional scoping keep working everywhere until an admin narrows them.
INSERT INTO "organizer_regions" ("user_id", "region_id")
	SELECT u."id", r."id" FROM "users" u CROSS JOIN "regions" r
	WHERE u."role" = 'ORGANIZER' AND r."level" = 1
	ON CONFLICT DO NOTHING;
