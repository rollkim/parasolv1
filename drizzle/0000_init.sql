CREATE TYPE "public"."admin_role" AS ENUM('owner', 'manager');--> statement-breakpoint
CREATE TYPE "public"."auth_provider" AS ENUM('local', 'kakao', 'naver', 'google');--> statement-breakpoint
CREATE TYPE "public"."author_type" AS ENUM('admin', 'customer', 'guest');--> statement-breakpoint
CREATE TYPE "public"."board_type" AS ENUM('notice', 'faq', 'qna');--> statement-breakpoint
CREATE TYPE "public"."bulk_inquiry_status" AS ENUM('received', 'contacted', 'closed');--> statement-breakpoint
CREATE TYPE "public"."claim_fault" AS ENUM('buyer', 'seller');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('requested', 'approved', 'rejected', 'collecting', 'inspecting', 'done');--> statement-breakpoint
CREATE TYPE "public"."claim_type" AS ENUM('cancel', 'exchange', 'return');--> statement-breakpoint
CREATE TYPE "public"."coupon_issue_method" AS ENUM('download', 'code', 'auto');--> statement-breakpoint
CREATE TYPE "public"."coupon_scope" AS ENUM('all', 'category', 'product');--> statement-breakpoint
CREATE TYPE "public"."coupon_type" AS ENUM('fixed', 'percent');--> statement-breakpoint
CREATE TYPE "public"."image_kind" AS ENUM('thumbnail', 'detail');--> statement-breakpoint
CREATE TYPE "public"."order_channel" AS ENUM('web', 'npay');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'paid', 'preparing', 'shipping', 'delivered', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('ready', 'paid', 'partial_cancelled', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."point_type" AS ENUM('earn', 'use', 'expire', 'cancel', 'manual');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('draft', 'active', 'hidden');--> statement-breakpoint
CREATE TABLE "address" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"customer_id" bigint NOT NULL,
	"label" text,
	"recipient" text NOT NULL,
	"phone" text NOT NULL,
	"zipcode" text NOT NULL,
	"addr1" text NOT NULL,
	"addr2" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_activity_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"admin_user_id" bigint,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"diff" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_user" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"login_id" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" "admin_role" DEFAULT 'manager' NOT NULL,
	"totp_secret" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "article" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"content" text NOT NULL,
	"cover_image_path" text,
	"maker_id" bigint,
	"is_featured" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "banner" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"slot" text NOT NULL,
	"title" text,
	"kicker" text,
	"subtitle" text,
	"cta_label" text,
	"image_path" text NOT NULL,
	"mobile_image_path" text,
	"alt" text NOT NULL,
	"link_url" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "board" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" "board_type" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "bulk_inquiry" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"purchase_type_code" text NOT NULL,
	"company_name" text,
	"business_no" text,
	"manager_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"quantity" integer,
	"budget" integer,
	"due_date" timestamp with time zone,
	"need_tax_invoice" boolean DEFAULT false NOT NULL,
	"content" text,
	"status" "bulk_inquiry_status" DEFAULT 'received' NOT NULL,
	"admin_memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "cart" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"customer_id" bigint,
	"session_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cart_item" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cart_id" bigint NOT NULL,
	"variant_id" bigint NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cart_item_addon" (
	"cart_item_id" bigint NOT NULL,
	"addon_id" bigint NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "cart_item_addon_cart_item_id_addon_id_pk" PRIMARY KEY("cart_item_id","addon_id")
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"parent_id" bigint,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	CONSTRAINT "category_slug_ascii_ck" CHECK ("category"."slug" ~ '^[a-z0-9-]+$')
);
--> statement-breakpoint
CREATE TABLE "claim" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"claim_no" text NOT NULL,
	"order_id" bigint NOT NULL,
	"type" "claim_type" NOT NULL,
	"status" "claim_status" DEFAULT 'requested' NOT NULL,
	"reason_code" text NOT NULL,
	"fault" "claim_fault" NOT NULL,
	"detail" text,
	"photos" jsonb,
	"goods_amount" integer DEFAULT 0 NOT NULL,
	"shipping_fee" integer DEFAULT 0 NOT NULL,
	"refund_amount" integer DEFAULT 0 NOT NULL,
	"admin_memo" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "claim_item" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"claim_id" bigint NOT NULL,
	"order_item_id" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_status_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"claim_id" bigint NOT NULL,
	"from_status" "claim_status",
	"to_status" "claim_status" NOT NULL,
	"actor" text NOT NULL,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"post_id" bigint NOT NULL,
	"author_type" "author_type" NOT NULL,
	"customer_id" bigint,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "common_code" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_code" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"meta" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	CONSTRAINT "common_code_ascii_ck" CHECK ("common_code"."group_code" ~ '^[a-z0-9_]+$' AND "common_code"."code" ~ '^[a-z0-9_]+$')
);
--> statement-breakpoint
CREATE TABLE "coupon" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" "coupon_type" NOT NULL,
	"value" integer NOT NULL,
	"max_discount" integer,
	"min_order_amount" integer DEFAULT 0 NOT NULL,
	"scope" "coupon_scope" DEFAULT 'all' NOT NULL,
	"scope_ref_id" bigint,
	"issue_method" "coupon_issue_method" DEFAULT 'download' NOT NULL,
	"code" text,
	"total_quantity" integer,
	"issued_count" integer DEFAULT 0 NOT NULL,
	"valid_days" integer,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "coupon_issue" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"coupon_id" bigint NOT NULL,
	"customer_id" bigint NOT NULL,
	"expires_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"order_id" bigint,
	"discount_amount" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"grade_id" bigint,
	"email" text,
	"name" text NOT NULL,
	"phone" text,
	"admin_memo" text,
	"point_balance" integer DEFAULT 0 NOT NULL,
	"marketing_sms_agreed_at" timestamp with time zone,
	"marketing_email_agreed_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_auth" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"customer_id" bigint NOT NULL,
	"provider" "auth_provider" NOT NULL,
	"provider_uid" text NOT NULL,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_grade" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"bonus_rate" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "display_section" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'manual' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "display_section_product" (
	"section_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "display_section_product_section_id_product_id_pk" PRIMARY KEY("section_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"variant_id" bigint,
	"addon_id" bigint,
	"delta" integer NOT NULL,
	"stock_after" integer NOT NULL,
	"reason" text NOT NULL,
	"ref_id" text,
	"memo" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inv_log_target_ck" CHECK (("inventory_log"."variant_id" IS NOT NULL) <> ("inventory_log"."addon_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "login_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"subject_type" "author_type" NOT NULL,
	"subject_id" bigint,
	"provider" text,
	"success" boolean NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maker" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"summary" text,
	"story" text,
	"image_path" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	CONSTRAINT "maker_slug_ascii_ck" CHECK ("maker"."slug" ~ '^[a-z0-9-]+$')
);
--> statement-breakpoint
CREATE TABLE "order_item" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_id" bigint NOT NULL,
	"variant_id" bigint,
	"product_id" bigint,
	"product_name" text NOT NULL,
	"maker_name" text,
	"variant_name" text,
	"unit_price" integer NOT NULL,
	"quantity" integer NOT NULL,
	"line_total" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_item_qty_ck" CHECK ("order_item"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "order_item_addon" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_item_id" bigint NOT NULL,
	"addon_name" text NOT NULL,
	"unit_price" integer NOT NULL,
	"quantity" integer NOT NULL,
	"line_total" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_status_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_id" bigint NOT NULL,
	"from_status" "order_status",
	"to_status" "order_status" NOT NULL,
	"actor" text NOT NULL,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_no" text NOT NULL,
	"customer_id" bigint,
	"guest_token" text,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"channel" "order_channel" DEFAULT 'web' NOT NULL,
	"orderer_name" text NOT NULL,
	"orderer_phone" text NOT NULL,
	"orderer_email" text,
	"recipient" text NOT NULL,
	"phone" text NOT NULL,
	"zipcode" text NOT NULL,
	"addr1" text NOT NULL,
	"addr2" text,
	"delivery_memo" text,
	"subtotal" integer NOT NULL,
	"shipping_fee" integer DEFAULT 0 NOT NULL,
	"coupon_discount" integer DEFAULT 0 NOT NULL,
	"point_used" integer DEFAULT 0 NOT NULL,
	"grand_total" integer NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_token" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"customer_id" bigint NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_id" bigint NOT NULL,
	"provider" text DEFAULT 'tosspayments' NOT NULL,
	"payment_key" text,
	"method" text,
	"amount" integer NOT NULL,
	"status" "payment_status" DEFAULT 'ready' NOT NULL,
	"approved_at" timestamp with time zone,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_cancellation" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"payment_id" bigint NOT NULL,
	"claim_id" bigint,
	"amount" integer NOT NULL,
	"reason" text,
	"raw" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "point_transaction" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"customer_id" bigint NOT NULL,
	"type" "point_type" NOT NULL,
	"amount" integer NOT NULL,
	"remaining_amount" integer,
	"balance_after" integer NOT NULL,
	"title" text NOT NULL,
	"tag_code" text,
	"order_id" bigint,
	"expires_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"board_id" bigint NOT NULL,
	"product_id" bigint,
	"category_code" text,
	"author_type" "author_type" NOT NULL,
	"customer_id" bigint,
	"guest_name" text,
	"guest_phone" text,
	"guest_password_hash" text,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"attachments" jsonb,
	"is_secret" boolean DEFAULT false NOT NULL,
	"is_answered" boolean DEFAULT false NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"maker_id" bigint,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"summary" text,
	"description" text,
	"status" "product_status" DEFAULT 'draft' NOT NULL,
	"badge_label" text,
	"sales_count" integer DEFAULT 0 NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"rating_sum" integer DEFAULT 0 NOT NULL,
	"min_price" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	CONSTRAINT "product_slug_ascii_ck" CHECK ("product"."slug" ~ '^[a-z0-9-]+$')
);
--> statement-breakpoint
CREATE TABLE "product_addon" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_id" bigint NOT NULL,
	"name" text NOT NULL,
	"price" integer NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "product_category" (
	"product_id" bigint NOT NULL,
	"category_id" bigint NOT NULL,
	CONSTRAINT "product_category_product_id_category_id_pk" PRIMARY KEY("product_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "product_image" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_id" bigint NOT NULL,
	"kind" "image_kind" DEFAULT 'thumbnail' NOT NULL,
	"path" text NOT NULL,
	"alt" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "product_option" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_id" bigint NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "product_option_value" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"option_id" bigint NOT NULL,
	"value" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "product_variant" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_id" bigint NOT NULL,
	"sku" text,
	"price" integer NOT NULL,
	"compare_at_price" integer,
	"stock" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	CONSTRAINT "variant_price_ck" CHECK ("product_variant"."price" >= 0),
	CONSTRAINT "variant_stock_ck" CHECK ("product_variant"."stock" >= 0)
);
--> statement-breakpoint
CREATE TABLE "promotion" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"hero_image_path" text,
	"hero_mobile_image_path" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "promotion_product" (
	"promotion_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"special_price" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "promotion_product_promotion_id_product_id_pk" PRIMARY KEY("promotion_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "restock_notification" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"variant_id" bigint NOT NULL,
	"customer_id" bigint,
	"phone" text,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_id" bigint NOT NULL,
	"order_item_id" bigint,
	"customer_id" bigint,
	"rating" integer NOT NULL,
	"content" text NOT NULL,
	"tags" jsonb,
	"images" jsonb,
	"admin_reply" text,
	"admin_reply_at" timestamp with time zone,
	"report_count" integer DEFAULT 0 NOT NULL,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_rating_ck" CHECK ("review"."rating" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "review_report" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"review_id" bigint NOT NULL,
	"customer_id" bigint,
	"reason" text NOT NULL,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_id" bigint NOT NULL,
	"claim_id" bigint,
	"carrier" text,
	"tracking_no" text,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "site_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "terms_agreement" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"customer_id" bigint,
	"order_id" bigint,
	"terms_document_id" bigint NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terms_document" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"version" text NOT NULL,
	"content" text NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "variant_option_value" (
	"variant_id" bigint NOT NULL,
	"option_value_id" bigint NOT NULL,
	CONSTRAINT "variant_option_value_variant_id_option_value_id_pk" PRIMARY KEY("variant_id","option_value_id")
);
--> statement-breakpoint
CREATE TABLE "wishlist" (
	"customer_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wishlist_customer_id_product_id_pk" PRIMARY KEY("customer_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "address" ADD CONSTRAINT "address_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_activity_log" ADD CONSTRAINT "admin_activity_log_admin_user_id_admin_user_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article" ADD CONSTRAINT "article_maker_id_maker_id_fk" FOREIGN KEY ("maker_id") REFERENCES "public"."maker"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart" ADD CONSTRAINT "cart_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_item" ADD CONSTRAINT "cart_item_cart_id_cart_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."cart"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_item" ADD CONSTRAINT "cart_item_variant_id_product_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_item_addon" ADD CONSTRAINT "cart_item_addon_cart_item_id_cart_item_id_fk" FOREIGN KEY ("cart_item_id") REFERENCES "public"."cart_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_item_addon" ADD CONSTRAINT "cart_item_addon_addon_id_product_addon_id_fk" FOREIGN KEY ("addon_id") REFERENCES "public"."product_addon"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_parent_id_category_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_item" ADD CONSTRAINT "claim_item_claim_id_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_item" ADD CONSTRAINT "claim_item_order_item_id_order_item_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_status_history" ADD CONSTRAINT "claim_status_history_claim_id_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_post_id_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_issue" ADD CONSTRAINT "coupon_issue_coupon_id_coupon_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupon"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_issue" ADD CONSTRAINT "coupon_issue_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_issue" ADD CONSTRAINT "coupon_issue_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_grade_id_customer_grade_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."customer_grade"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_auth" ADD CONSTRAINT "customer_auth_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "display_section_product" ADD CONSTRAINT "display_section_product_section_id_display_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."display_section"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "display_section_product" ADD CONSTRAINT "display_section_product_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_log" ADD CONSTRAINT "inventory_log_variant_id_product_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_log" ADD CONSTRAINT "inventory_log_addon_id_product_addon_id_fk" FOREIGN KEY ("addon_id") REFERENCES "public"."product_addon"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_variant_id_product_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_addon" ADD CONSTRAINT "order_item_addon_order_item_id_order_item_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_token" ADD CONSTRAINT "password_reset_token_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_cancellation" ADD CONSTRAINT "payment_cancellation_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_cancellation" ADD CONSTRAINT "payment_cancellation_claim_id_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claim"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_transaction" ADD CONSTRAINT "point_transaction_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_transaction" ADD CONSTRAINT "point_transaction_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_maker_id_maker_id_fk" FOREIGN KEY ("maker_id") REFERENCES "public"."maker"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_addon" ADD CONSTRAINT "product_addon_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_category" ADD CONSTRAINT "product_category_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_category" ADD CONSTRAINT "product_category_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_image" ADD CONSTRAINT "product_image_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option" ADD CONSTRAINT "product_option_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_value" ADD CONSTRAINT "product_option_value_option_id_product_option_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."product_option"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_product" ADD CONSTRAINT "promotion_product_promotion_id_promotion_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotion"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_product" ADD CONSTRAINT "promotion_product_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restock_notification" ADD CONSTRAINT "restock_notification_variant_id_product_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restock_notification" ADD CONSTRAINT "restock_notification_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_order_item_id_order_item_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_report" ADD CONSTRAINT "review_report_review_id_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."review"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_report" ADD CONSTRAINT "review_report_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_claim_id_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claim"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms_agreement" ADD CONSTRAINT "terms_agreement_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms_agreement" ADD CONSTRAINT "terms_agreement_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms_agreement" ADD CONSTRAINT "terms_agreement_terms_document_id_terms_document_id_fk" FOREIGN KEY ("terms_document_id") REFERENCES "public"."terms_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_option_value" ADD CONSTRAINT "variant_option_value_variant_id_product_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_option_value" ADD CONSTRAINT "variant_option_value_option_value_id_product_option_value_id_fk" FOREIGN KEY ("option_value_id") REFERENCES "public"."product_option_value"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist" ADD CONSTRAINT "wishlist_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist" ADD CONSTRAINT "wishlist_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aal_entity_idx" ON "admin_activity_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_login_uq" ON "admin_user" USING btree ("login_id");--> statement-breakpoint
CREATE UNIQUE INDEX "article_slug_uq" ON "article" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "board_slug_uq" ON "board" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "cart_session_idx" ON "cart" USING btree ("session_token");--> statement-breakpoint
CREATE INDEX "cart_item_cart_idx" ON "cart_item" USING btree ("cart_id");--> statement-breakpoint
CREATE UNIQUE INDEX "category_slug_uq" ON "category" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_no_uq" ON "claim" USING btree ("claim_no");--> statement-breakpoint
CREATE INDEX "claim_order_idx" ON "claim" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "claim_status_idx" ON "claim" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "common_code_uq" ON "common_code" USING btree ("group_code","code");--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_code_uq" ON "coupon" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_issue_uq" ON "coupon_issue" USING btree ("coupon_id","customer_id");--> statement-breakpoint
CREATE INDEX "coupon_issue_customer_idx" ON "coupon_issue" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_email_idx" ON "customer" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_auth_uq" ON "customer_auth" USING btree ("provider","provider_uid");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_grade_code_uq" ON "customer_grade" USING btree ("code");--> statement-breakpoint
CREATE INDEX "inv_log_variant_idx" ON "inventory_log" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "maker_slug_uq" ON "maker" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "order_item_order_idx" ON "order_item" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "osh_order_idx" ON "order_status_history" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_no_uq" ON "orders" USING btree ("order_no");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "orders_status_created_idx" ON "orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prt_token_uq" ON "password_reset_token" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_key_uq" ON "payment" USING btree ("payment_key");--> statement-breakpoint
CREATE INDEX "payment_order_idx" ON "payment" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "point_customer_idx" ON "point_transaction" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "point_expires_idx" ON "point_transaction" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "post_board_idx" ON "post" USING btree ("board_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_slug_uq" ON "product" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "product_status_idx" ON "product" USING btree ("status");--> statement-breakpoint
CREATE INDEX "product_maker_idx" ON "product" USING btree ("maker_id");--> statement-breakpoint
CREATE INDEX "product_image_idx" ON "product_image" USING btree ("product_id","kind","position");--> statement-breakpoint
CREATE UNIQUE INDEX "variant_sku_uq" ON "product_variant" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "variant_product_idx" ON "product_variant" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_slug_uq" ON "promotion" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "restock_variant_idx" ON "restock_notification" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_order_item_uq" ON "review" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "review_product_idx" ON "review" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "terms_doc_uq" ON "terms_document" USING btree ("code","version");