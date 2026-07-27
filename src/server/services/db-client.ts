import "server-only";

import type { db as Database } from "@/db";

/**
 * 트랜잭션 안팎에서 같은 함수를 재사용하기 위한 클라이언트 타입.
 * 서비스마다 따로 선언하면 정의가 갈리므로 여기 한 곳에서만 정의한다(RULE-14).
 */
export type DatabaseClient = typeof Database;
export type TransactionClient = Parameters<
  Parameters<DatabaseClient["transaction"]>[0]
>[0];
export type QueryClient = DatabaseClient | TransactionClient;
