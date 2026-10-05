CREATE TABLE "languages" (
	"code" text PRIMARY KEY NOT NULL,
	"native_name" text NOT NULL,
	"english_name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "languages_code_format" CHECK ("languages"."code" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$')
);
--> statement-breakpoint
CREATE TABLE "legal_document_translations" (
	"document_id" uuid NOT NULL,
	"language_code" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	CONSTRAINT "legal_document_translations_document_id_language_code_pk" PRIMARY KEY("document_id","language_code"),
	CONSTRAINT "legal_document_translations_length" CHECK (char_length("legal_document_translations"."title") between 1 and 200 and char_length("legal_document_translations"."body") between 1 and 100000)
);
--> statement-breakpoint
CREATE TABLE "legal_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"version" integer NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "legal_documents_type_version_key" UNIQUE("type","version"),
	CONSTRAINT "legal_documents_type_valid" CHECK ("legal_documents"."type" in ('TERMS', 'PRIVACY', 'CANCELLATION', 'REFUND')),
	CONSTRAINT "legal_documents_version_positive" CHECK ("legal_documents"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "match_translations" (
	"match_id" uuid NOT NULL,
	"language_code" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"rules" text,
	"location_instructions" text,
	"equipment_requirements" text,
	"cancellation_policy" text,
	CONSTRAINT "match_translations_match_id_language_code_pk" PRIMARY KEY("match_id","language_code"),
	CONSTRAINT "match_translations_title_length" CHECK (char_length("match_translations"."title") between 1 and 200),
	CONSTRAINT "match_translations_body_length" CHECK (coalesce(char_length("match_translations"."description"), 0) <= 5000
        and coalesce(char_length("match_translations"."rules"), 0) <= 5000
        and coalesce(char_length("match_translations"."location_instructions"), 0) <= 5000
        and coalesce(char_length("match_translations"."equipment_requirements"), 0) <= 5000
        and coalesce(char_length("match_translations"."cancellation_policy"), 0) <= 5000)
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizer_id" uuid NOT NULL,
	"source_language" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"players_per_side" smallint NOT NULL,
	"fee_krw" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matches_players_per_side_range" CHECK ("matches"."players_per_side" between 3 and 11),
	CONSTRAINT "matches_fee_range" CHECK ("matches"."fee_krw" between 0 and 1000000)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"channel" text NOT NULL,
	"language_code" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "notifications_type_valid" CHECK ("notifications"."type" in ('PAYMENT_CONFIRMED', 'PARTICIPATION_CONFIRMED')),
	CONSTRAINT "notifications_channel_valid" CHECK ("notifications"."channel" in ('PUSH', 'EMAIL', 'SMS')),
	CONSTRAINT "notifications_status_valid" CHECK ("notifications"."status" in ('PENDING', 'SENT', 'FAILED'))
);
--> statement-breakpoint
CREATE TABLE "payment_instruction_translations" (
	"payment_instruction_id" uuid NOT NULL,
	"language_code" text NOT NULL,
	"bank_name" text NOT NULL,
	"instructions" text NOT NULL,
	CONSTRAINT "payment_instruction_translations_payment_instruction_id_language_code_pk" PRIMARY KEY("payment_instruction_id","language_code"),
	CONSTRAINT "payment_instruction_translations_length" CHECK (char_length("payment_instruction_translations"."bank_name") between 1 and 100 and char_length("payment_instruction_translations"."instructions") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "payment_instructions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_number" text NOT NULL,
	"account_holder" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_instructions_account_number_length" CHECK (char_length("payment_instructions"."account_number") between 4 and 64)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"role" text DEFAULT 'PLAYER' NOT NULL,
	"preferred_language" text,
	"device_locale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_role_valid" CHECK ("users"."role" in ('PLAYER', 'ORGANIZER', 'ADMIN')),
	CONSTRAINT "users_display_name_length" CHECK (char_length("users"."display_name") between 1 and 100),
	CONSTRAINT "users_device_locale_length" CHECK (char_length("users"."device_locale") <= 35)
);
--> statement-breakpoint
ALTER TABLE "legal_document_translations" ADD CONSTRAINT "legal_document_translations_document_id_legal_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."legal_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_document_translations" ADD CONSTRAINT "legal_document_translations_language_code_languages_code_fk" FOREIGN KEY ("language_code") REFERENCES "public"."languages"("code") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_translations" ADD CONSTRAINT "match_translations_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_translations" ADD CONSTRAINT "match_translations_language_code_languages_code_fk" FOREIGN KEY ("language_code") REFERENCES "public"."languages"("code") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_organizer_id_users_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_source_language_languages_code_fk" FOREIGN KEY ("source_language") REFERENCES "public"."languages"("code") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_language_code_languages_code_fk" FOREIGN KEY ("language_code") REFERENCES "public"."languages"("code") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "payment_instruction_translations" ADD CONSTRAINT "payment_instruction_translations_payment_instruction_id_payment_instructions_id_fk" FOREIGN KEY ("payment_instruction_id") REFERENCES "public"."payment_instructions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_instruction_translations" ADD CONSTRAINT "payment_instruction_translations_language_code_languages_code_fk" FOREIGN KEY ("language_code") REFERENCES "public"."languages"("code") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "payment_instructions" ADD CONSTRAINT "payment_instructions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_preferred_language_languages_code_fk" FOREIGN KEY ("preferred_language") REFERENCES "public"."languages"("code") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "matches_starts_at_idx" ON "matches" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "matches_organizer_idx" ON "matches" USING btree ("organizer_id");--> statement-breakpoint
CREATE INDEX "notifications_pending_idx" ON "notifications" USING btree ("created_at") WHERE "notifications"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_instructions_single_active_idx" ON "payment_instructions" USING btree ("is_active") WHERE "payment_instructions"."is_active";--> statement-breakpoint
CREATE INDEX "users_preferred_language_idx" ON "users" USING btree ("preferred_language");