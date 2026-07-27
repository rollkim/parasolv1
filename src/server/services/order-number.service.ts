import "server-only";

import { sql } from "drizzle-orm";

import {
  type ClaimType,
  formatClaimNo,
  formatOrderNo,
} from "@/domain/order-number";

import type { QueryClient } from "./db-client";

/**
 * 주문·클레임 번호 채번 — 전역 시퀀스(order_no_seq·claim_no_seq)에서 원자적으로 얻는다.
 *
 * 시퀀스는 트랜잭션 롤백에도 되돌아가지 않으므로(설계 의도) 번호에 격차가 생길 수 있다.
 * 격차는 허용하고 중복은 절대 허용하지 않는다 — MAX+1 방식은 동시 주문에서 중복이 나므로 금지.
 * 날짜 접두(KST)는 표시용이라 SQL에서 한 번에 계산해 자정 경계 스큐를 없앤다.
 */

type SequenceName = "order_no_seq" | "claim_no_seq";

/** 시퀀스 다음 값 + KST 날짜를 한 번의 쿼리로 — 두 값이 서로 어긋나지 않게 */
async function nextSequenceWithKstDate(
  client: QueryClient,
  sequenceName: SequenceName,
): Promise<{ ymd: string; seq: number }> {
  // 시퀀스 이름은 외부 입력이 아니라 이 모듈의 상수 유니온이라 식별자 삽입이 안전하다
  const result = await client.execute(
    sql`select to_char((now() at time zone 'Asia/Seoul')::date, 'YYYYMMDD') as ymd,
               nextval(${sequenceName}::regclass) as seq`,
  );
  const row = (result.rows ?? result)[0] as { ymd: string; seq: string | number };
  return { ymd: row.ymd, seq: Number(row.seq) };
}

/** "YYYYMMDD-####" — 주문 트랜잭션 안에서 호출한다 */
export async function allocateOrderNo(client: QueryClient): Promise<string> {
  const { ymd, seq } = await nextSequenceWithKstDate(client, "order_no_seq");
  return formatOrderNo(ymd, seq);
}

/** "{CN|EX|RT}-YYYYMMDD-####" */
export async function allocateClaimNo(
  client: QueryClient,
  claimType: ClaimType,
): Promise<string> {
  const { ymd, seq } = await nextSequenceWithKstDate(client, "claim_no_seq");
  return formatClaimNo(claimType, ymd, seq);
}
