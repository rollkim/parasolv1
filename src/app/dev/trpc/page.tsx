"use client";

// 개발 전용 — tRPC 배선(⑤)의 DB 관통을 확인한다.
// 브라우저 → /api/trpc → 라우터 → 서비스 → 개발 DB → 되돌아온 값을 렌더한다.
// production에서 404.

import { useQuery } from "@tanstack/react-query";
import { notFound } from "next/navigation";

import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/trpc/client";

export default function TrpcProbePage() {
  if (process.env.NODE_ENV === "production") notFound();

  const trpc = useTRPC();
  const businessInfoQuery = useQuery(
    trpc.siteSetting.get.queryOptions({ key: "business_info" }),
  );

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-[26px] font-extrabold">
          tRPC 관통 확인
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          siteSetting.get(&quot;business_info&quot;)를 서버까지 호출한 결과입니다.
          시드가 없으면 <code>null</code>이 정상(배선은 살아 있음), 오류가 뜨면
          연결이 끊긴 것입니다.
        </p>
      </header>

      <section className="rounded-lg border border-border bg-card p-5">
        {businessInfoQuery.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : businessInfoQuery.isError ? (
          <div className="text-sm font-semibold text-destructive">
            오류: {businessInfoQuery.error.message}
          </div>
        ) : businessInfoQuery.data === null ? (
          <div className="text-sm text-muted-foreground">
            <span className="font-bold text-foreground">null</span> — 배선 정상,
            아직 business_info 시드가 없습니다.
          </div>
        ) : (
          <pre className="overflow-x-auto text-[13px] leading-relaxed">
            {JSON.stringify(businessInfoQuery.data, null, 2)}
          </pre>
        )}
      </section>
    </div>
  );
}
