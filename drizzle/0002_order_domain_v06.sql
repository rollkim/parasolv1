ALTER TABLE "inventory_log" DROP CONSTRAINT "inv_log_target_ck";--> statement-breakpoint
ALTER TABLE "inventory_log" DROP CONSTRAINT "inventory_log_variant_id_product_variant_id_fk";
--> statement-breakpoint
ALTER TABLE "inventory_log" DROP CONSTRAINT "inventory_log_addon_id_product_addon_id_fk";
--> statement-breakpoint
ALTER TABLE "order_item_addon" ADD COLUMN "addon_id" bigint;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inventory_log" ADD CONSTRAINT "inventory_log_variant_id_product_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_log" ADD CONSTRAINT "inventory_log_addon_id_product_addon_id_fk" FOREIGN KEY ("addon_id") REFERENCES "public"."product_addon"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_addon" ADD CONSTRAINT "order_item_addon_addon_id_product_addon_id_fk" FOREIGN KEY ("addon_id") REFERENCES "public"."product_addon"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inv_log_addon_idx" ON "inventory_log" USING btree ("addon_id");--> statement-breakpoint
CREATE INDEX "inv_log_ref_idx" ON "inventory_log" USING btree ("ref_id","reason");--> statement-breakpoint
CREATE INDEX "order_item_addon_addon_idx" ON "order_item_addon" USING btree ("addon_id");--> statement-breakpoint
CREATE INDEX "orders_guest_token_idx" ON "orders" USING btree ("guest_token") WHERE "orders"."guest_token" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "orders_delivered_at_idx" ON "orders" USING btree ("delivered_at") WHERE "orders"."status" = 'delivered';--> statement-breakpoint
CREATE UNIQUE INDEX "payment_order_active_uq" ON "payment" USING btree ("order_id") WHERE "payment"."status" <> 'failed';--> statement-breakpoint
ALTER TABLE "inventory_log" ADD CONSTRAINT "inv_log_target_ck" CHECK (NOT ("inventory_log"."variant_id" IS NOT NULL AND "inventory_log"."addon_id" IS NOT NULL));