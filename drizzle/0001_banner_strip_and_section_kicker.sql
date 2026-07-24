ALTER TABLE "banner" ALTER COLUMN "image_path" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "banner" ALTER COLUMN "alt" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "banner" ADD COLUMN "tone_code" text;--> statement-breakpoint
ALTER TABLE "display_section" ADD COLUMN "kicker" text;--> statement-breakpoint
ALTER TABLE "banner" ADD CONSTRAINT "banner_alt_required_ck" CHECK ("banner"."image_path" IS NULL OR "banner"."alt" IS NOT NULL);