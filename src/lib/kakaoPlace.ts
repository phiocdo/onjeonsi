/**
 * 카카오맵 링크 규칙: 장소 페이지(place.map.kakao.com/{id}) 주소, ID를 모를 때의 지도 링크,
 * 장소 검색에 쓸 검색어와 검색 결과 중 맞는 장소를 고르는 규칙.
 *
 * - 화면(kakaoMapLink.ts)과 시설 ID 후보 찾기 스크립트(scripts/find-kakao-place-ids.ts)가 같은 규칙을 쓴다.
 *   그래서 이 파일은 브라우저 SDK나 catalog.ts(import.meta.glob)를 import하지 않는다.
 * - 틀린 장소 페이지가 좌표 핀 지도보다 나쁘다. 이름이 확실히 맞을 때만 고르고, 아니면 null을 돌려준다.
 */

/** 카카오 장소 검색 결과 한 건. 로컬 REST API와 JS SDK(services.Places)가 같은 모양을 준다 */
export interface KakaoPlace {
  id: string;
  place_name: string;
  category_group_code?: string;
  category_name?: string;
  address_name?: string;
  road_address_name?: string;
  place_url?: string;
  /** 검색 중심 좌표에서 떨어진 거리(m). 중심 좌표를 넘겼을 때만 온다 */
  distance?: string;
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** 장소 검색 반경(m). 전시 좌표가 건물 입구와 조금 어긋나도 찾을 만큼만 넓힌다 */
export const PLACE_SEARCH_RADIUS = 500;

/** 한 장소에 던지는 검색어 수 상한 */
const MAX_QUERIES = 4;

/** 이름이 이보다 짧은 결과는 포함 관계로 맞추지 않는다 (예: '서울') */
const MIN_MATCH_LENGTH = 3;

/** 이 이름만으로는 어느 곳인지 알 수 없다. 우리 이름이든 결과 이름이든 이것뿐이면 맞추지 않는다 */
const GENERIC_NAMES = new Set(
  ['갤러리', '미술관', '박물관', '전시관', '전시장', '전시실', '기념관', '아트센터', '아트홀', '문화센터', '문화원', '도서관', '공연장', 'gallery', 'museum'],
);

/**
 * 고를 수 있는 분류(category_group_code). CT1 문화시설, AT4 관광명소, 그리고 빈 코드.
 * 본 장소도 코드가 빈 경우가 많다("동대문디자인플라자", "갤러리제이원 서울", "남산골한옥마을").
 * 숙박(AD5)·학원(AC5)·병원(HP8)·주차장(PK6)·음식점(FD6) 같은 나머지 분류는 이름이 맞아도 시설이 아니다
 * ("와이아트 갤러리" 근처의 학원 "와이아트").
 */
const VENUE_CATEGORIES = new Set(['CT1', 'AT4', '']);

/**
 * 결과 이름이 우리 이름보다 길 때(우리 이름 ⊂ 결과 이름) 고를 수 있는 분류. 빈 코드는 받지 않는다.
 * 부속 장소는 늘 시설 이름 뒤에 뭔가 붙은 이름이고 코드가 빈 경우가 많다:
 * "서울시립미술관 자료실"(도서관), "서울시립미술관후원회"(단체), "남산골한옥마을 정문 개방화장실", "DDP패션몰".
 */
const SUFFIXED_OK_CATEGORIES = new Set(['CT1', 'AT4']);

// "10:00~18:00" 같은 운영시간 문구가 장소 이름 칸에 들어온 경우 (원문 placeName↔hoursText 뒤바뀜)
const TIME_LIKE = /\d{1,2}:\d{2}/;

// 괄호 안 (반각·전각·대괄호). engine/matchVenue.ts의 이름 정규화와 같은 괄호를 지운다
const BRACKETED = /\([^)]*\)|（[^）]*）|\[[^\]]*\]/g;

// 장소 안의 위치를 가리키는 낱말. 여기부터 뒤는 장소 이름이 아니다 ("기획전시실", "로비", "3층")
const ROOM_WORD = /(전시실|로비|층)$/;

/** 장소 페이지 주소 */
export function kakaoPlaceUrl(id: string): string {
  return `https://place.map.kakao.com/${encodeURIComponent(id)}`;
}

/**
 * 장소 ID를 모를 때의 링크. 좌표가 있으면 그 자리에 핀을 꽂은 지도, 없으면 이름 검색.
 * 핀 지도 주소는 "이름,위도,경도"를 쉼표로 나누므로 이름의 쉼표는 공백으로 바꾼다.
 */
export function kakaoMapUrl(name: string, pos: LatLng | null): string {
  if (!pos) return `https://map.kakao.com/link/search/${encodeURIComponent(name)}`;
  const label = encodeURIComponent(name.replace(/[,，]/g, ' ').replace(/\s+/g, ' ').trim());
  return `https://map.kakao.com/link/map/${label},${pos.lat},${pos.lng}`;
}

/**
 * 카카오 결과와 비교할 이름: 글자·숫자만 남기고 소문자로 ("서울시립미술관(SeMA)" → "서울시립미술관sema").
 * 시설 연결용 engine/matchVenue.ts의 normalizePlaceName과는 규칙이 다르다.
 */
export function normalizeKakaoName(name: string): string {
  return name.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * 장소 이름으로 던질 검색어. 앞의 것부터 차례로 검색한다.
 *
 * 전시 원문 장소 이름에는 층·전시실이 붙어 있어 그대로는 잘 안 잡힌다.
 *   "서울시립미술관 서소문본관 1층 전시실" → ["서울시립미술관 서소문본관", "서울시립미술관"]
 *   "동대문디자인플라자(DDP) 쇼룸 1층 (서울 중구 을지로 281)" → ["동대문디자인플라자 쇼룸", "동대문디자인플라자"]
 * - 괄호 안은 지운다.
 * - 둘째 낱말부터, 숫자·쉼표·빗금이 들었거나("1층", "전시1동", "1,2F", "1/2관") 전시실·로비·층으로 끝나는
 *   낱말("기획전시실")이 나오면 거기부터 뒤는 버린다. 첫 낱말은 숫자가 있어도 둔다("문화역서울284").
 * - 괄호 밖에 운영시간 문구가 있거나 첫 낱말부터 쉼표·빗금으로 나열하면("교육동, 기타장소") 검색하지 않는다.
 */
export function placeSearchQueries(name: string): string[] {
  const stripped = name.replace(BRACKETED, ' ');
  if (TIME_LIKE.test(stripped)) return [];
  const words = stripped.split(/\s+/).filter(Boolean);
  if (!words.length || /[,/]/.test(words[0])) return [];
  const cut = words.findIndex((word, i) => i > 0 && (/[\d,/]/.test(word) || ROOM_WORD.test(word)));
  const head = cut === -1 ? words : words.slice(0, cut);

  const queries: string[] = [];
  for (let n = head.length; n >= 1 && queries.length < MAX_QUERIES; n--) {
    queries.push(head.slice(0, n).join(' '));
  }
  return queries;
}

/**
 * 검색 결과 중 `name`과 이름이 맞는 장소를 고른다. 없으면 null.
 *
 * 비교 기준은 검색어 중 가장 긴 것(층·괄호를 뗀 전체 이름)이다. 짧은 검색어("갤러리")로 찾았어도
 * 결과는 전체 이름("갤러리 딜라이트")과 맞아야 한다 → 근처의 아무 갤러리나 고르지 않는다.
 * 우선순위:
 *   1. 이름이 같다. 낱말 순서만 다른 것도 같다고 본다 ("갤러리 딜라이트" = "딜라이트 갤러리")
 *   2. 결과 이름이 우리 이름에 들어 있다 = 더 넓은 장소 ("운현궁" ⊂ "운현궁 노락당"). 긴 것 먼저
 *   3. 우리 이름이 결과 이름에 들어 있다 ("서울시립미술관" ⊂ "서울시립미술관 서소문본관"). 짧은 것 먼저.
 *      부속 장소가 모두 이 모양이라 문화시설·관광명소 분류만 받는다 (SUFFIXED_OK_CATEGORIES)
 * 2·3은 짧은 쪽이 긴 쪽의 절반 이상이어야 한다 ("갤러리" ⊂ "갤러리 딜라이트"는 안 맞음).
 * 문화시설·관광명소·빈 코드가 아닌 분류(숙박·학원·주차장 등)와 "갤러리"·"미술관" 같은 일반 이름은 처음부터 뺀다.
 */
export function pickPlace(results: readonly KakaoPlace[], name: string): KakaoPlace | null {
  const full = placeSearchQueries(name)[0] ?? '';
  const ours = normalizeKakaoName(full);
  if (ours.length < MIN_MATCH_LENGTH || GENERIC_NAMES.has(ours)) return null;
  const ourWords = wordSet(full);

  const candidates = results
    .filter((place) => VENUE_CATEGORIES.has(place.category_group_code ?? ''))
    .map((place) => ({ place, theirs: normalizeKakaoName(place.place_name) }))
    .filter(({ theirs }) => theirs.length >= MIN_MATCH_LENGTH && !GENERIC_NAMES.has(theirs));

  const exact = candidates.find(
    ({ place, theirs }) => theirs === ours || wordSet(place.place_name) === ourWords,
  );
  if (exact) return exact.place;

  const inside = candidates
    .filter(({ theirs }) => ours.includes(theirs) && theirs.length * 2 >= ours.length)
    .sort((a, b) => b.theirs.length - a.theirs.length);
  if (inside.length) return inside[0].place;

  const around = candidates
    .filter(({ place }) => SUFFIXED_OK_CATEGORIES.has(place.category_group_code ?? ''))
    .filter(({ theirs }) => theirs.includes(ours) && ours.length * 2 >= theirs.length)
    .sort((a, b) => a.theirs.length - b.theirs.length);
  return around[0]?.place ?? null;
}

/** 낱말 순서를 무시한 비교용 값 ("딜라이트 갤러리" → "갤러리 딜라이트") */
function wordSet(name: string): string {
  return name
    .split(/\s+/)
    .map(normalizeKakaoName)
    .filter(Boolean)
    .sort()
    .join(' ');
}

/**
 * 검색어를 차례로 던져 처음 맞는 장소를 돌려준다. 검색 방법(REST API, JS SDK)은 부르는 쪽이 넘긴다.
 * 좌표 없이 이름만으로 찾으면 다른 지역의 같은 이름이 잡히므로 좌표는 필수다.
 */
export async function findPlace(
  name: string,
  pos: LatLng,
  search: (query: string, pos: LatLng) => Promise<readonly KakaoPlace[]>,
): Promise<KakaoPlace | null> {
  for (const query of placeSearchQueries(name)) {
    const picked = pickPlace(await search(query, pos), name);
    if (picked) return picked;
  }
  return null;
}
