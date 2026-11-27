/**
 * find-kakao-place-ids.ts가 쓰는 순수 함수. 네트워크·파일을 건드리지 않아 테스트할 수 있다.
 */
import type { KakaoPlace } from '../src/lib/kakaoPlace.ts';

/**
 * 시설 파일 글자에 "kakaoPlaceId"를 "lng" 바로 다음 줄로 끼워 넣는다.
 * JSON.stringify로 다시 쓰면 한 줄로 적은 hours 항목이 여러 줄로 풀리므로 글자로 넣는다.
 * 넣지 못하면 이유를 돌려준다: 'exists' 이미 kakaoPlaceId 칸이 있음(빈 값 포함), 'no-lng' 쉼표로 끝나는 "lng" 줄이 없음.
 */
export function insertKakaoPlaceId(
  text: string,
  id: string,
): { ok: true; text: string } | { ok: false; reason: 'exists' | 'no-lng' } {
  if (/"kakaoPlaceId"\s*:/.test(text)) return { ok: false, reason: 'exists' };
  const lng = /^([ \t]*)"lng"\s*:\s*[^,\r\n]+,[ \t]*(\r?\n)/m.exec(text);
  if (!lng) return { ok: false, reason: 'no-lng' };
  const [line, indent, newline] = lng;
  const at = lng.index + line.length;
  return {
    ok: true,
    text: `${text.slice(0, at)}${indent}"kakaoPlaceId": ${JSON.stringify(id)},${newline}${text.slice(at)}`,
  };
}

/** 후보 한 줄: "17952661 국립현대미술관 서울 · 미술관 · 서울 종로구 삼청로 30 · 120m" */
export function describePlace(place: KakaoPlace): string {
  const category = place.category_name?.split('>').pop()?.trim();
  const address = place.road_address_name || place.address_name;
  const distance = place.distance ? `${place.distance}m` : '';
  return [`${place.id} ${place.place_name}`, category, address, distance].filter(Boolean).join(' · ');
}
