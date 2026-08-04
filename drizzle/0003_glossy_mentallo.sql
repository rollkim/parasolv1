CREATE TABLE "uploaded_file" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"storage_path" text NOT NULL,
	"byte_size" integer NOT NULL,
	"owner_type" text,
	"owner_id" bigint,
	"delete_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "cart_session_idx";--> statement-breakpoint
DROP INDEX "coupon_issue_uq";--> statement-breakpoint
DROP INDEX "payment_order_active_uq";--> statement-breakpoint
ALTER TABLE "admin_user" ADD COLUMN "totp_last_used_step" bigint;--> statement-breakpoint
ALTER TABLE "article" ADD COLUMN "category_code" text;--> statement-breakpoint
ALTER TABLE "article" ADD COLUMN "product_id" bigint;--> statement-breakpoint
ALTER TABLE "article" ADD COLUMN "author_name" text;--> statement-breakpoint
ALTER TABLE "claim" ADD COLUMN "coupon_deduction" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "claim" ADD COLUMN "fee_method" text;--> statement-breakpoint
ALTER TABLE "claim" ADD COLUMN "fee_settled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claim" ADD COLUMN "fee_memo" text;--> statement-breakpoint
ALTER TABLE "coupon" ADD COLUMN "per_customer_limit" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_grade" ADD COLUMN "min_recent_spend" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_item" ADD COLUMN "list_price" integer;--> statement-breakpoint
ALTER TABLE "order_item" ADD COLUMN "thumbnail_path" text;--> statement-breakpoint
ALTER TABLE "order_item" ADD COLUMN "thumbnail_alt" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "claim_id" bigint;--> statement-breakpoint
ALTER TABLE "payment_cancellation" ADD COLUMN "refund_channel" text DEFAULT 'pg_api' NOT NULL;--> statement-breakpoint
ALTER TABLE "point_transaction" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "product_category" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "promotion" ADD COLUMN "coupon_id" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "uploaded_file_path_uq" ON "uploaded_file" USING btree ("storage_path");--> statement-breakpoint
CREATE INDEX "uploaded_file_orphan_idx" ON "uploaded_file" USING btree ("created_at") WHERE "uploaded_file"."owner_type" IS NULL;--> statement-breakpoint
CREATE INDEX "uploaded_file_delete_idx" ON "uploaded_file" USING btree ("delete_after") WHERE "uploaded_file"."delete_after" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "uploaded_file_owner_idx" ON "uploaded_file" USING btree ("owner_type","owner_id");--> statement-breakpoint
ALTER TABLE "article" ADD CONSTRAINT "article_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_claim_id_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claim"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion" ADD CONSTRAINT "promotion_coupon_id_coupon_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupon"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_product_idx" ON "article" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_session_token_uq" ON "cart" USING btree ("session_token") WHERE "cart"."session_token" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "coupon_issue_coupon_customer_idx" ON "coupon_issue" USING btree ("coupon_id","customer_id");--> statement-breakpoint
CREATE INDEX "payment_claim_idx" ON "payment" USING btree ("claim_id") WHERE "payment"."claim_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "point_dedupe_uq" ON "point_transaction" USING btree ("dedupe_key") WHERE "point_transaction"."dedupe_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "product_category_primary_uq" ON "product_category" USING btree ("product_id") WHERE "product_category"."is_primary";--> statement-breakpoint
CREATE UNIQUE INDEX "payment_order_active_uq" ON "payment" USING btree ("order_id") WHERE "payment"."status" <> 'failed' AND "payment"."claim_id" IS NULL;--> statement-breakpoint
ALTER TABLE "article" ADD CONSTRAINT "article_category_code_ascii_ck" CHECK ("article"."category_code" IS NULL OR "article"."category_code" ~ '^[a-z0-9_]+$');--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_fee_method_ck" CHECK ("claim"."fee_method" IS NULL OR "claim"."fee_method" ~ '^[a-z_]+$');--> statement-breakpoint
ALTER TABLE "payment_cancellation" ADD CONSTRAINT "pc_refund_channel_ck" CHECK ("payment_cancellation"."refund_channel" ~ '^[a-z_]+$');