import Link from "next/link";

/**
 * 루트 404 — 어떤 라우트에도 맞지 않는 주소가 여기로 온다.
 *
 * `(store)/not-found.tsx`는 스토어 세그먼트 안에서만 적용된다. 라우트 그룹은 URL에
 * 나타나지 않으므로, /search처럼 아무 세그먼트에도 속하지 않는 주소는 이 파일이 없으면
 * Next 기본 영문 404("This page could not be found")가 그대로 노출된다.
 *
 * 스토어 셸(헤더·푸터)이 없는 위치라 site_setting을 읽지 않는다 — 여기서 DB를 읽으면
 * DB 장애 시 404 화면까지 함께 죽는다. 업체 표기가 필요한 안내는 스토어 404가 맡는다.
 */
export default function RootNotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="m-0 text-[13px] font-bold tracking-wider text-muted-foreground">ERROR 404</p>
      <h1 className="m-0 font-heading text-2xl font-extrabold">페이지를 찾을 수 없어요</h1>
      <p className="m-0 max-w-sm text-sm leading-relaxed text-muted-foreground">
        주소가 바뀌었거나 삭제된 페이지일 수 있어요. 입력하신 주소가 정확한지 확인해 주세요.
      </p>
      <Link
        href="/"
        className="mt-2 inline-flex min-h-11 items-center rounded-md bg-primary px-5 font-bold text-primary-foreground"
      >
        메인으로
      </Link>
    </main>
  );
}
