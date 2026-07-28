/**
 * 다음(카카오) 우편번호 검색 — 무료이며 API 키가 없다. 스크립트만 실으면 된다.
 *
 * 팝업(새 창)이 아니라 임베드 레이어를 쓴다: 결제 직전 화면에서 새 창이 뜨면 팝업 차단에
 * 걸리거나 모바일에서 탭이 갈려 체크아웃 맥락을 잃는다.
 */

const DAUM_POSTCODE_SDK_URL =
  "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";

export type DaumPostcodeResult = {
  zonecode: string;
  /** 도로명 주소(사용자가 지번을 골랐으면 지번 주소) */
  address: string;
  /** 건물명 등 참고항목 — "(역삼동, 개나리아파트)" 형태로 조합해 쓴다 */
  buildingName: string;
  bname: string;
  userSelectedType: "R" | "J";
  roadAddress: string;
  jibunAddress: string;
};

type DaumPostcodeConstructor = new (options: {
  oncomplete: (result: DaumPostcodeResult) => void;
  onclose?: () => void;
  width?: string;
  height?: string;
}) => { embed: (container: HTMLElement) => void };

declare global {
  interface Window {
    daum?: { Postcode: DaumPostcodeConstructor };
  }
}

let sdkLoadPromise: Promise<DaumPostcodeConstructor> | null = null;

function loadDaumPostcodeSdk(): Promise<DaumPostcodeConstructor> {
  if (window.daum?.Postcode) return Promise.resolve(window.daum.Postcode);
  sdkLoadPromise ??= new Promise<DaumPostcodeConstructor>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = DAUM_POSTCODE_SDK_URL;
    script.async = true;
    script.onload = () => {
      if (window.daum?.Postcode) resolve(window.daum.Postcode);
      else reject(new Error("주소 검색을 불러오지 못했습니다."));
    };
    script.onerror = () => {
      // 실패한 약속을 남기면 재시도가 영원히 막힌다
      sdkLoadPromise = null;
      reject(new Error("주소 검색을 불러오지 못했습니다. 네트워크를 확인해 주세요."));
    };
    document.head.appendChild(script);
  });
  return sdkLoadPromise;
}

/**
 * 선택 결과 → 우리 폼 값.
 * 도로명을 고르면 참고항목(동·건물명)을 괄호로 덧붙인다 — 배송 기사가 찾기 쉬운 형태다.
 */
export function toAddressFields(result: DaumPostcodeResult): {
  zipcode: string;
  addr1: string;
} {
  const baseAddress =
    result.userSelectedType === "R" ? result.roadAddress : result.jibunAddress;

  const extraParts: string[] = [];
  if (result.userSelectedType === "R") {
    if (result.bname && /[동로가]$/.test(result.bname)) extraParts.push(result.bname);
    if (result.buildingName) extraParts.push(result.buildingName);
  }

  return {
    zipcode: result.zonecode,
    addr1: extraParts.length > 0 ? `${baseAddress} (${extraParts.join(", ")})` : baseAddress,
  };
}

/** 컨테이너 안에 검색 레이어를 띄운다. 선택하면 onSelect가 불리고 레이어는 닫힌다 */
export async function openDaumPostcode(input: {
  container: HTMLElement;
  onSelect: (fields: { zipcode: string; addr1: string }) => void;
  onClose?: () => void;
}): Promise<void> {
  const Postcode = await loadDaumPostcodeSdk();
  const postcode = new Postcode({
    oncomplete: (result) => {
      input.onSelect(toAddressFields(result));
      input.container.replaceChildren();
      input.onClose?.();
    },
    onclose: () => {
      input.container.replaceChildren();
      input.onClose?.();
    },
    width: "100%",
    height: "100%",
  });
  postcode.embed(input.container);
}
