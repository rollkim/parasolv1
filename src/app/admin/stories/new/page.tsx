import type { Metadata } from "next";

import { AdminStoryFormView } from "@/components/admin/admin-story-view";

export const metadata: Metadata = { title: "이야기 작성" };
export const dynamic = "force-dynamic";

export default function AdminStoryNewPage() {
  return <AdminStoryFormView articleId={null} />;
}
