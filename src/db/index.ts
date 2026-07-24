import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// 저트래픽 전제 — 커넥션 풀 소규모 유지 (개발: SSH 터널 경유 명율 서버)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

export const db = drizzle(pool, { schema });
