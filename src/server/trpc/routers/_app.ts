import { createCallerFactory, router } from "../init";
import { authRouter } from "./auth";
import { cartRouter } from "./cart";
import { claimRouter } from "./claim";
import { mypageRouter } from "./mypage";
import { orderRouter } from "./order";
import { siteSettingRouter } from "./site-setting";
import { supportRouter } from "./support";
import { wishlistRouter } from "./wishlist";

/**
 * 최상위 라우터 — 도메인별 하위 라우터를 여기 합친다.
 * 화면·기능이 늘면 이 목록에 라우터를 추가한다(product·cart·order…).
 */
export const appRouter = router({
  auth: authRouter,
  cart: cartRouter,
  claim: claimRouter,
  mypage: mypageRouter,
  order: orderRouter,
  siteSetting: siteSettingRouter,
  support: supportRouter,
  wishlist: wishlistRouter,
});

/** 프론트엔드가 타입만 가져다 쓰는 계약. 런타임 코드는 포함되지 않는다. */
export type AppRouter = typeof appRouter;

/** 서버 컴포넌트·배치에서 HTTP 없이 프로시저를 직접 호출할 때 쓰는 팩토리 */
export const createCaller = createCallerFactory(appRouter);
