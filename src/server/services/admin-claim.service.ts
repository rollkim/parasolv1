import "server-only";

import { and, asc, count, desc, eq, ilike, inArray, or } from "drizzle-orm";

import {
  claim,
  claimItem,
  claimStatusHistory,
  orderItem,
  orders,
  payment,
} from "@/db/schema";
import {
  availableClaimActions,
  claimStatusLabel,
  claimTimelineFor,
  claimTypeLabel,
  type ClaimActionOption,
  type ClaimFault,
  type ClaimFeeMethod,
  type ClaimStatus,
  type ClaimType,
} from "@/domain/claim";
import { formatPhone } from "@/domain/phone";

import { getActiveCommonCodesWithMeta } from "./common-code.service";
import type { DatabaseClient } from "./db-client";

/**
 * 관리자 클레임 관리 — 조회 전용 조립 레이어.
 *
 * **처리(승인·반려·회수·환불·교환발송)는 여기 없다.** C3(claim-process)·C4(claim-refund)가
 * 이미 맡고 있고, 관리자용 사본을 만들면 전이·재고·원장 규칙이 두 벌이 된다.
 * 이 모듈은 "무엇을 보여주고 지금 무엇을 누를 수 있는가"만 답한다.
 */

export type AdminClaimStatusFilter = ClaimStatus | "all";
export type AdminClaimTypeFilter = ClaimType | "all";

export type AdminClaimCard = {
  claimId: number;
  claimNo: string;
  claimType: ClaimType;
  claimTypeLabel: string;
  claimStatus: ClaimStatus;
  claimStatusLabel: string;
  orderNo: string;
  buyerName: string;
  reasonLabel: string;
  leadProductName: string;
  itemCount: number;
  requestedAt: Date;
  /** 계좌이체 배송비인데 아직 미입금 — 교환품 발송이 막혀 있는 건 */
  feeAwaiting: boolean;
};

export type AdminClaimListResult = {
  cards: AdminClaimCard[];
  totalCount: number;
  page: number;
  pageSize: number;
  /** 상태별 건수(KPI 카드) — 처리해야 할 일이 어디 몰려 있는지 */
  statusCounts: Record<ClaimStatus, number>;
  /** 유형별 건수(유형 탭). all은 전체 */
  typeCounts: Record<AdminClaimTypeFilter, number>;
};

const ADMIN_CLAIM_PAGE_SIZE = 20;

/** 사유 코드 → 한글 표시명. 목록·상세가 같은 표를 쓴다 */
async function loadReasonLabels(database: DatabaseClient): Promise<Map<string, string>> {
  const rows = await getActiveCommonCodesWithMeta(database, "claim_reason");
  return new Map(rows.map((row) => [row.code, row.name]));
}

/**
 * 클레임 목록. 검색은 접수번호·주문번호·신청자명·연락처를 한 입력으로 받는다
 * (주문 목록과 같은 이유 — CS가 전화를 받으며 쓴다).
 */
export async function listAdminClaims(
  database: DatabaseClient,
  input: {
    claimStatus?: AdminClaimStatusFilter;
    claimTypeFilter?: AdminClaimTypeFilter;
    keyword?: string;
    page?: number;
  } = {},
): Promise<AdminClaimListResult> {
  const statusFilterValue = input.claimStatus ?? "all";
  const typeFilterValue = input.claimTypeFilter ?? "all";
  const page = Math.max(1, input.page ?? 1);
  const keyword = input.keyword?.trim();

  const statusFilter =
    statusFilterValue === "all" ? undefined : eq(claim.status, statusFilterValue);
  const typeFilter = typeFilterValue === "all" ? undefined : eq(claim.type, typeFilterValue);
  const keywordFilter = keyword
    ? or(
        ilike(claim.claimNo, `%${keyword}%`),
        ilike(orders.orderNo, `%${keyword}%`),
        ilike(orders.ordererName, `%${keyword}%`),
        // 연락처는 정규화 저장이라 입력의 하이픈을 떼고 비교한다
        ilike(orders.ordererPhone, `%${keyword.replace(/[^0-9]/g, "")}%`),
      )
    : undefined;
  const listFilter = and(statusFilter, typeFilter, keywordFilter);

  const [totalRow] = await database
    .select({ total: count() })
    .from(claim)
    .innerJoin(orders, eq(claim.orderId, orders.id))
    .where(listFilter);
  const totalCount = totalRow?.total ?? 0;

  const claimRows = await database
    .select({
      claimId: claim.id,
      claimNo: claim.claimNo,
      claimType: claim.type,
      claimStatus: claim.status,
      reasonCode: claim.reasonCode,
      shippingFee: claim.shippingFee,
      feeMethod: claim.feeMethod,
      feeSettledAt: claim.feeSettledAt,
      requestedAt: claim.createdAt,
      orderNo: orders.orderNo,
      buyerName: orders.ordererName,
    })
    .from(claim)
    .innerJoin(orders, eq(claim.orderId, orders.id))
    .where(listFilter)
    .orderBy(desc(claim.id))
    .limit(ADMIN_CLAIM_PAGE_SIZE)
    .offset((page - 1) * ADMIN_CLAIM_PAGE_SIZE);

  const claimIds = claimRows.map((row) => row.claimId);
  const itemRows =
    claimIds.length === 0
      ? []
      : await database
          .select({ claimId: claimItem.claimId, productName: orderItem.productName })
          .from(claimItem)
          .innerJoin(orderItem, eq(claimItem.orderItemId, orderItem.id))
          .where(inArray(claimItem.claimId, claimIds));

  // 뱃지 건수 — 상태·유형 각각 한 번의 group by로 얻는다(탭마다 쿼리하지 않는다)
  const statusCountRows = await database
    .select({ claimStatus: claim.status, total: count() })
    .from(claim)
    .groupBy(claim.status);
  const typeCountRows = await database
    .select({ claimType: claim.type, total: count() })
    .from(claim)
    .groupBy(claim.type);

  const statusCounts = {
    requested: 0,
    approved: 0,
    rejected: 0,
    collecting: 0,
    inspecting: 0,
    done: 0,
  } satisfies Record<ClaimStatus, number>;
  for (const row of statusCountRows) statusCounts[row.claimStatus] = row.total;

  const typeCounts: Record<AdminClaimTypeFilter, number> = {
    all: typeCountRows.reduce((sum, row) => sum + row.total, 0),
    cancel: 0,
    return: 0,
    exchange: 0,
  };
  for (const row of typeCountRows) typeCounts[row.claimType] = row.total;

  const reasonLabels = await loadReasonLabels(database);

  return {
    cards: claimRows.map((row) => {
      const lines = itemRows.filter((item) => item.claimId === row.claimId);
      return {
        claimId: row.claimId,
        claimNo: row.claimNo,
        claimType: row.claimType,
        claimTypeLabel: claimTypeLabel(row.claimType),
        claimStatus: row.claimStatus,
        claimStatusLabel: claimStatusLabel(row.claimStatus),
        orderNo: row.orderNo,
        buyerName: row.buyerName,
        reasonLabel: reasonLabels.get(row.reasonCode) ?? row.reasonCode,
        // 취소는 주문 전체가 대상이라 claim_item이 없다
        leadProductName: lines[0]?.productName ?? "주문 전체",
        itemCount: lines.length,
        requestedAt: row.requestedAt,
        feeAwaiting:
          row.feeMethod === "bank_transfer" && row.shippingFee > 0 && row.feeSettledAt === null,
      };
    }),
    totalCount,
    page,
    pageSize: ADMIN_CLAIM_PAGE_SIZE,
    statusCounts,
    typeCounts,
  };
}

export class AdminClaimNotFoundError extends Error {
  constructor(readonly claimNo: string) {
    super(`클레임을 찾을 수 없습니다: ${claimNo}`);
    this.name = "AdminClaimNotFoundError";
  }
}

export type AdminClaimDetail = {
  claimId: number;
  claimNo: string;
  claimType: ClaimType;
  claimTypeLabel: string;
  claimStatus: ClaimStatus;
  claimStatusLabel: string;
  requestedAt: Date;
  resolvedAt: Date | null;
  /** 지금 누를 수 있는 행동 — 도메인 전이표가 정한다. 화면은 이것만 그린다 */
  availableActions: ClaimActionOption[];
  timeline: { steps: readonly string[]; currentStep: number | null; outOfTimeline: boolean };
  request: {
    reasonCode: string;
    reasonLabel: string;
    fault: ClaimFault;
    faultLabel: string;
    detail: string | null;
    photos: string[];
  };
  order: {
    orderNo: string;
    orderStatus: string;
    ordererName: string;
    ordererPhone: string;
    orderShippingFee: number;
  };
  amounts: { goodsAmount: number; shippingFee: number; refundAmount: number };
  fee: {
    method: ClaimFeeMethod | null;
    methodLabel: string | null;
    /** 고객에게서 따로 받아야 하는가 — 환불금 차감은 자동 정산이라 대기열에 올리면 안 된다 */
    requiresDeposit: boolean;
    settledAt: Date | null;
    memo: string | null;
  };
  /** 환불 채널 선택에 필요한 정보 — pg_api가 가능한 상태인지 관리자가 판단한다 */
  paymentSummary: {
    method: string | null;
    status: string;
    amount: number;
    hasPaymentKey: boolean;
  } | null;
  items: {
    claimItemId: number;
    productName: string;
    optionLabel: string | null;
    unitPrice: number;
    claimQuantity: number;
    orderedQuantity: number;
    lineAmount: number;
  }[];
  history: { toStatus: ClaimStatus; toStatusLabel: string; actor: string; memo: string | null; at: Date }[];
  adminMemo: string | null;
};

const FEE_METHOD_LABELS: Record<ClaimFeeMethod, string> = {
  deduct_refund: "환불금 차감",
  bank_transfer: "계좌이체 입금",
  card: "카드 결제",
};

const FAULT_LABELS: Record<ClaimFault, string> = {
  buyer: "구매자 귀책",
  seller: "판매자 귀책",
};

/** 관리자 상세 — 고객 화면과 달리 마스킹하지 않는다(CS가 연락처로 전화한다) */
export async function getAdminClaimDetail(
  database: DatabaseClient,
  claimNo: string,
): Promise<AdminClaimDetail> {
  const [row] = await database
    .select({
      claimId: claim.id,
      claimNo: claim.claimNo,
      claimType: claim.type,
      claimStatus: claim.status,
      reasonCode: claim.reasonCode,
      fault: claim.fault,
      detail: claim.detail,
      photos: claim.photos,
      goodsAmount: claim.goodsAmount,
      shippingFee: claim.shippingFee,
      refundAmount: claim.refundAmount,
      feeMethod: claim.feeMethod,
      feeSettledAt: claim.feeSettledAt,
      feeMemo: claim.feeMemo,
      adminMemo: claim.adminMemo,
      resolvedAt: claim.resolvedAt,
      requestedAt: claim.createdAt,
      orderId: claim.orderId,
      orderNo: orders.orderNo,
      orderStatus: orders.status,
      ordererName: orders.ordererName,
      ordererPhone: orders.ordererPhone,
      orderShippingFee: orders.shippingFee,
    })
    .from(claim)
    .innerJoin(orders, eq(claim.orderId, orders.id))
    .where(eq(claim.claimNo, claimNo))
    .limit(1);
  if (!row) throw new AdminClaimNotFoundError(claimNo);

  const items = await database
    .select({
      claimItemId: claimItem.id,
      claimQuantity: claimItem.quantity,
      productName: orderItem.productName,
      optionLabel: orderItem.variantName,
      unitPrice: orderItem.unitPrice,
      orderedQuantity: orderItem.quantity,
    })
    .from(claimItem)
    .innerJoin(orderItem, eq(claimItem.orderItemId, orderItem.id))
    .where(eq(claimItem.claimId, row.claimId))
    .orderBy(asc(claimItem.id));

  const historyRows = await database
    .select({
      toStatus: claimStatusHistory.toStatus,
      actor: claimStatusHistory.actor,
      memo: claimStatusHistory.memo,
      at: claimStatusHistory.createdAt,
    })
    .from(claimStatusHistory)
    .where(eq(claimStatusHistory.claimId, row.claimId))
    .orderBy(desc(claimStatusHistory.id));

  // 본결제(claim_id IS NULL) 한 건 — 환불 채널 판단 근거
  const [paymentRow] = await database
    .select({
      method: payment.method,
      status: payment.status,
      amount: payment.amount,
      paymentKey: payment.paymentKey,
    })
    .from(payment)
    .where(and(eq(payment.orderId, row.orderId), inArray(payment.status, ["paid", "partial_cancelled"])))
    .orderBy(desc(payment.id))
    .limit(1);

  const reasonLabels = await loadReasonLabels(database);
  const feeMethod = (row.feeMethod as ClaimFeeMethod | null) ?? null;

  return {
    claimId: row.claimId,
    claimNo: row.claimNo,
    claimType: row.claimType,
    claimTypeLabel: claimTypeLabel(row.claimType),
    claimStatus: row.claimStatus,
    claimStatusLabel: claimStatusLabel(row.claimStatus),
    requestedAt: row.requestedAt,
    resolvedAt: row.resolvedAt,
    availableActions: availableClaimActions({
      claimType: row.claimType,
      status: row.claimStatus,
      feeMethod,
      shippingFee: row.shippingFee,
      feeSettledAt: row.feeSettledAt,
    }),
    timeline: claimTimelineFor(row.claimType, row.claimStatus),
    request: {
      reasonCode: row.reasonCode,
      reasonLabel: reasonLabels.get(row.reasonCode) ?? row.reasonCode,
      fault: row.fault,
      faultLabel: FAULT_LABELS[row.fault],
      detail: row.detail,
      photos: Array.isArray(row.photos) ? (row.photos as string[]) : [],
    },
    order: {
      orderNo: row.orderNo,
      orderStatus: row.orderStatus,
      ordererName: row.ordererName,
      // 저장은 정규화(01012123434)지만 CS가 읽고 받아적는 화면이라 하이픈을 붙여 준다
      ordererPhone: formatPhone(row.ordererPhone),
      orderShippingFee: row.orderShippingFee,
    },
    amounts: {
      goodsAmount: row.goodsAmount,
      shippingFee: row.shippingFee,
      refundAmount: row.refundAmount,
    },
    fee: {
      method: feeMethod,
      methodLabel: feeMethod ? FEE_METHOD_LABELS[feeMethod] : null,
      requiresDeposit: feeMethod !== null && feeMethod !== "deduct_refund" && row.shippingFee > 0,
      settledAt: row.feeSettledAt,
      memo: row.feeMemo,
    },
    paymentSummary: paymentRow
      ? {
          method: paymentRow.method,
          status: paymentRow.status,
          amount: paymentRow.amount,
          // 키를 노출하지 않는다 — 있는지 여부만 알면 pg_api 가능 여부를 판단할 수 있다
          hasPaymentKey: paymentRow.paymentKey !== null,
        }
      : null,
    items: items.map((item) => ({
      claimItemId: item.claimItemId,
      productName: item.productName,
      optionLabel: item.optionLabel,
      unitPrice: item.unitPrice,
      claimQuantity: item.claimQuantity,
      orderedQuantity: item.orderedQuantity,
      lineAmount: item.unitPrice * item.claimQuantity,
    })),
    history: historyRows.map((historyRow) => ({
      toStatus: historyRow.toStatus,
      toStatusLabel: claimStatusLabel(historyRow.toStatus),
      actor: historyRow.actor,
      memo: historyRow.memo,
      at: historyRow.at,
    })),
    adminMemo: row.adminMemo,
  };
}

/** 내부 메모 — 상태·금액과 무관한 운영 기록이라 전이를 거치지 않는다 */
export async function saveAdminClaimMemo(
  database: DatabaseClient,
  input: { claimNo: string; memo: string },
): Promise<{ claimNo: string }> {
  const memo = input.memo.trim();
  const updated = await database
    .update(claim)
    .set({ adminMemo: memo.length > 0 ? memo : null })
    .where(eq(claim.claimNo, input.claimNo))
    .returning({ claimNo: claim.claimNo });
  if (updated.length === 0) throw new AdminClaimNotFoundError(input.claimNo);
  return { claimNo: updated[0].claimNo };
}

/** 처리 라우터가 claimNo(화면 식별자)를 id(서비스 식별자)로 바꿀 때 쓴다 */
export async function resolveClaimIdByNo(
  database: DatabaseClient,
  claimNo: string,
): Promise<number> {
  const [row] = await database
    .select({ id: claim.id })
    .from(claim)
    .where(eq(claim.claimNo, claimNo))
    .limit(1);
  if (!row) throw new AdminClaimNotFoundError(claimNo);
  return row.id;
}
