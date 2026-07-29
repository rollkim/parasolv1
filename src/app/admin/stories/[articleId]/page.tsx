import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminStoryFormView } from "@/components/admin/admin-story-view";

export const metadata: Metadata = { title: "이야기 수정" };
export const dynamic = "force-dynamic";

export default async function AdminStoryEditPage({
  params,
}: {
  params: Promise<{ articleId: string }>;
}) {
  const { articleId } = await params;
  const parsed = Number.parseInt(articleId, 10);
  if (Number.isNaN(parsed) || parsed < 1) notFound();

  return <AdminStoryFormView articleId={parsed} />;
}
