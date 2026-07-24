import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// generate(SQL 생성)는 DB 접속 없이 동작한다.
// migrate/push/studio는 DATABASE_URL이 필요하며, RULE-2에 따라 사용자가 직접 실행한다.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
