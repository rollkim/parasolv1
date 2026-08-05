import { z } from "zod";

import { isMobilePhone, normalizePhone } from "@/domain/phone";

/**
 * 라우터가 공유하는 입력 스키마.
 *
 * 같은 성격의 값을 라우터마다 따로 정의하면 반드시 어긋난다 — 실제로 연락처가
 * 회원가입에서는 `^01[016789][0-9]{7,8}$`로 걸러졌는데 **주문에서는 길이만 검사**해서
 * 아무 글자나 통과했다(배송 사고로 직결된다).
 *
 * 여기 있는 것만 쓰고, 라우터에서 새로 만들지 않는다.
 */

/**
 * 휴대폰 번호 — 하이픈·공백을 지우고 저장 형태(숫자만)로 넘긴다.
 *
 * **정규화까지 여기서 끝낸다.** 검증만 하고 원본을 넘기면 서비스마다 다시 정규화해야 하고,
 * 한 곳이라도 빠뜨리면 저장 형태가 섞여 조회가 안 된다(교훈 16).
 */
export const mobilePhoneInput = z
  .string()
  .transform(normalizePhone)
  .refine(isMobilePhone, "휴대폰 번호 형식이 올바르지 않습니다. 예: 010-1234-5678");

/**
 * 선택 입력용 — 안 쓰면 null.
 *
 * **판정은 정규화 전 값으로 한다.** 먼저 숫자만 남기면 `ㅁㄴㅇㄹ`이 빈 문자열이 되어
 * "안 쓴 것"으로 통과해 버린다 — 잘못 입력한 연락처가 조용히 사라지는 쪽이
 * 오류를 내는 쪽보다 나쁘다(고객이 고쳤다고 믿는다).
 */
export const optionalMobilePhoneInput = z
  .string()
  .transform((rawPhone) => rawPhone.trim())
  .refine(
    (trimmed) => trimmed === "" || isMobilePhone(normalizePhone(trimmed)),
    "휴대폰 번호 형식이 올바르지 않습니다. 예: 010-1234-5678",
  )
  .transform((trimmed) => (trimmed === "" ? null : normalizePhone(trimmed)));

/**
 * 이메일 — 소문자로 눕혀서 저장한다.
 *
 * 대소문자를 그대로 두면 `A@b.com`으로 가입한 사람이 `a@b.com`으로 로그인하지 못하고,
 * 같은 주소가 중복 가입된다.
 */
export const emailInput = z
  .string()
  // **검증 전에** 다듬는다. 순서가 반대면 복사·붙여넣기로 딸려온 공백 하나에
  // "이메일 형식이 올바르지 않습니다"가 떠서 사용자가 원인을 못 찾는다.
  .transform((rawEmail) => rawEmail.trim().toLowerCase())
  .pipe(z.email("이메일 형식이 올바르지 않습니다. 다시 확인해 주세요."));

/** 선택 입력용 이메일 — 안 쓰면 null */
export const optionalEmailInput = z
  .string()
  .transform((rawEmail) => rawEmail.trim().toLowerCase())
  .refine(
    (email) => email === "" || z.email().safeParse(email).success,
    "이메일 형식이 올바르지 않습니다.",
  )
  .transform((email) => (email === "" ? null : email));

/** 선택 입력용 이메일(빈 문자열 유지) — 기존 라우터가 `null` 대신 `""`를 기대하는 자리 */
export const optionalEmailTextInput = z
  .string()
  .transform((rawEmail) => rawEmail.trim().toLowerCase())
  .refine(
    (email) => email === "" || z.email().safeParse(email).success,
    "이메일 형식이 올바르지 않습니다.",
  );

/**
 * 사람 이름 — 주문자·수령인 공통.
 * 상한은 화면 입력칸 `maxLength`와 같은 값을 쓴다(둘이 다르면 화면에서는 써지는데 서버가 거절한다).
 */
export const personNameInput = z
  .string()
  .trim()
  .min(1, "이름을 입력해 주세요.")
  .max(50, "이름은 50자 이하로 입력해 주세요.");
