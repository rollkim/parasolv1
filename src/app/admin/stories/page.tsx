import type { Metadata } from "next";

import { AdminStoryListView } from "@/components/admin/admin-story-view";

export const metadata: Metadata = { title: "이야기 관리" };
export const dynamic = "force-dynamic";

export default function AdminStoriesPage() {
  return <AdminStoryListView />;
}
