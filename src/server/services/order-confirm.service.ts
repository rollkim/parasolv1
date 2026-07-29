import "server-only";

import { and, eq, isNotNull, lt, sql } from "drizzle-orm";

import { orders } from "@/db/schema";
import { AUTO_CONFIRM_DAYS } from "@/domain/claim";

import type { DatabaseClient } from "./db-client";
import { applyOrderTransition } from "./order-status.service";

/**
 * 구매확정 — 고객 확정과 자동확정 두 경로.
 *
 * **이 모듈이 없으면 구매 적립이 한 번도 실행되지 않는다.** 전이표는 `delivered → confirmed`를
 * `["customer", "system"]`에만 허용하는데(관리자는 제외 — 운영자가 고객 대신 확정하면
 * 클레임 기한을 임의로 끊는 셈이다), 그 두 경로를 부르는 코드가 없었다.
 * 적립은 applyOrderTransition 안에 걸려 있으니 도달만 하면 자동으로 일어난다.
 */

export class OrderConfirmNotAllowedError extends Error {
  constructor() {
    super(
      "배송이 완료된 주문만 구매확정할 수 있어요. 주문 내역에서 상태를 확인해 주세요.",
    );
    this.name = "OrderConfirmNotAllowedError";
  }
}

/**
 * 고객이 직접 확정 — 마이페이지·주문상세의 '구매확정' 버튼.
 *
 * 남의 주문을 확정할 수 없게 customerId로 함께 조회한다. 없으면 소유 아님과 미존재를
 * 구분하지 않는다 — 구분되면 주문번호 대입으로 존재 여부를 캐낼 수 있다(주문조회와 같은 규약).
 */
export async function confirmOrderByCustomer(
  database: DatabaseClient,
  input: { orderNo: string; customerId: number },
): Promise<{ orderNo: string; confirmed: boolean }> {
  return database.transaction(async (tx) => {
    const [orderRow] = await tx
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(and(eq(orders.orderNo, input.orderNo), eq(orders.customerId, input.customerId)))
      .limit(1);
    if (!orderRow) throw new OrderConfirmNotAllowedError();
    // 이미 확정된 주문은 그대로 성공으로 돌려준다 — 두 번 눌렀다고 오류를 보일 이유가 없다
    if (orderRow.status === "confirmed") return { orderNo: input.orderNo, confirmed: false };
    if (orderRow.status !== "delivered") throw new OrderConfirmNotAllowedError();

    const result = await applyOrderTransition(tx, {
      orderId: orderRow.id,
      toStatus: "confirmed",
      actor: { role: "customer", id: input.customerId },
      memo: "고객 구매확정",
    });
    return { orderNo: input.orderNo, confirmed: result.changed };
  });
}

export type AutoConfirmReport = {
  scannedCount: number;
  confirmedOrderNos: string[];
  failed: { orderNo: string; message: string }[];
};

/**
 * 자동 구매확정 배치 — 배송완료 + AUTO_CONFIRM_DAYS(클레임 기한 다음 날)이 지난 주문.
 *
 * 확정을 **주문 단위로 각각 커밋한다.** 한 트랜잭션에 묶으면 한 건의 적립 실패가
 * 그날 전체를 되돌린다 — 하루치가 통째로 밀리는 것보다 실패한 건만 남기는 게 낫다.
 *
 * 클레임 기한 다음 날인 이유: 기한 안에 확정되면 고객이 반품을 신청할 수 있는 동안
 * 주문이 종결(terminal) 상태가 되어 신청 자체가 막힌다.
 */
export async function runAutoConfirm(
  database: DatabaseClient,
  options: { limit?: number } = {},
): Promise<AutoConfirmReport> {
  const limit = options.limit ?? 200;

  const targets = await database
    .select({ id: orders.id, orderNo: orders.orderNo })
    .from(orders)
    .where(
      and(
        eq(orders.status, "delivered"),
        isNotNull(orders.deliveredAt),
        // 인터벌을 파라미터로 넣으면 타입 캐스팅이 필요해 make_interval을 쓴다(대사 배치와 같은 방식)
        lt(orders.deliveredAt, sql`now() - make_interval(days => ${AUTO_CONFIRM_DAYS})`),
      ),
    )
    .limit(limit);

  const confirmedOrderNos: string[] = [];
  const failed: { orderNo: string; message: string }[] = [];

  for (const target of targets) {
    try {
      await database.transaction(async (tx) => {
        await applyOrderTransition(tx, {
          orderId: target.id,
          toStatus: "confirmed",
          actor: { role: "system" },
          memo: `자동 구매확정 (배송완료 +${AUTO_CONFIRM_DAYS}일)`,
        });
      });
      confirmedOrderNos.push(target.orderNo);
    } catch (error) {
      // 실패한 건은 상태가 delivered로 남아 다음 실행에서 다시 잡힌다
      failed.push({
        orderNo: target.orderNo,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { scannedCount: targets.length, confirmedOrderNos, failed };
}
