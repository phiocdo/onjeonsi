/**
 * 전시 주제 태그 (F-12 비슷한 전시). 데이터를 인자로 받는 순수 함수만 둔다.
 *
 * - 서울시 field(전시/미술, 교육/체험 …)는 거의 다 "전시/미술"이라 쓰지 않는다.
 * - 제목 + 장소 이름(placeName) + 연결된 시설 이름을 합친 문자열에서 키워드를 찾는다.
 *   제목 맨 앞의 대괄호 표기("[서울디자인재단]", "[서울역사박물관]" …, 여러 개면 모두)는 기관 표기로 보고 뺀다.
 *   장소 이름과 시설 이름은 그대로 본다.
 * - 연결된 시설이 VENUE_TAGS에 있으면 그 태그를 기본으로 더한다.
 * - 다른 낱말 안에서 잘못 걸리는 키워드는 정규식으로 앞뒤 조건을 둔다(아래 주석).
 */
import type { CatalogEntry } from './catalog';

export const TAGS = [
  '회화·수묵',
  '역사·유적',
  '공예',
  '현대미술',
  '디자인·캐릭터',
  '사진·미디어',
  '민속·소리',
] as const;

export type Tag = (typeof TAGS)[number];

/** 문자열은 포함 여부, 정규식은 test로 본다. 영문은 대소문자를 구분한다. */
export type Keyword = string | RegExp;

export const TAG_KEYWORDS: Record<Tag, readonly Keyword[]> = {
  '회화·수묵': [
    '회화',
    /그림(?!자)/, // 그림자
    '수묵',
    '서예',
    '서화',
    /(?<!문)화가/, // "문화가 있는 날"
    '초상',
    /산수(?!유)/, // 산수유
    '유화',
    '민화',
    '드로잉',
    // 추가: 데이터의 동양화·세밀화 전시가 기존 키워드로 안 걸림
    '동양화',
    '한국화',
    '세밀화',
    '판화',
  ],
  '역사·유적': [
    '역사',
    '유적',
    '유물',
    '조선',
    '고려',
    '왕실',
    /(?<!자)궁(?![금극리합핍색])/, // 궁금·궁극·궁리·궁합·궁핍·궁색·자궁 제외, 운현궁·별궁·"궁 ;"은 걸림
    /독립(?!영화|출판|서점)/, // 독립영화·독립출판
    '근대',
    '고고',
    '발굴',
    '기록',
    // "아카이브"는 넣지 않는다: 서울시립 미술아카이브 전시가 역사로 묶임 → VENUE_TAGS로 현대미술
    '문화유산',
  ],
  공예: [
    '공예',
    /(?<!지)도자/, // 지도자
    '옻칠',
    '금속',
    '매듭',
    '자수',
    '한지',
    '목가구',
    '섬유',
    // 추가
    '나전',
  ],
  현대미술: [
    '현대미술',
    '동시대',
    '설치',
    '개인전',
    '단체전',
    '비엔날레',
    // 추가: 갤러리 초대전·아트페어가 데이터에 있음
    '초대전',
    '아트페어',
  ],
  '디자인·캐릭터': [
    '디자인',
    '캐릭터',
    '일러스트',
    '그래픽',
    '패션',
    '굿즈',
    '브랜드',
    // 추가: placeName에 "동대문디자인플라자" 없이 "DDP"만 적힌 전시가 있음
    'DDP',
    '건축',
    '팝업',
  ],
  '사진·미디어': [
    '사진',
    '영상',
    '미디어',
    '디지털',
    /빛(?!나)/, // 빛나다(꾸밈말)
    '프로젝션',
    '인터랙티브',
  ],
  '민속·소리': [
    '민속',
    '소리',
    '국악',
    '전통',
    '놀이',
    '생활사',
    '음악',
    // 추가
    '아리랑',
  ],
};

/**
 * 대표 시설 기본 태그 (data/venues/*.json의 id). 키워드 태그와 합친다.
 * 목록에 없는 시설(venue-mmca 등)은 키워드 태그만 쓴다.
 */
export const VENUE_TAGS: Readonly<Record<string, readonly Tag[]>> = {
  'venue-sema': ['현대미술'],
  'venue-sema-archive': ['현대미술'],
  'venue-craft-museum': ['공예'],
  'venue-seoul-uri-sori-museum': ['민속·소리'],
  'venue-park-no-soo-museum': ['회화·수묵'],
  'venue-korean-art-museum': ['회화·수묵'],
  'venue-seoul-history-museum': ['역사·유적'],
  'venue-gongpyeong-site-museum': ['역사·유적'],
  'venue-insa-site-museum': ['역사·유적'],
};

function hit(text: string, keyword: Keyword): boolean {
  return typeof keyword === 'string' ? text.includes(keyword) : keyword.test(text);
}

/** 제목 맨 앞의 대괄호 표기(여러 개면 모두)를 뺀다. "[A] [B] 제목" → "제목" */
export function stripLeadingBrackets(title: string): string {
  return title.replace(/^(?:\s*\[[^\]]*\])+\s*/, '');
}

/** 태그를 찾을 문자열: 제목(앞 대괄호 표기 뺌) + 장소 이름 + 연결된 시설 이름 */
export function tagText(entry: Pick<CatalogEntry, 'exhibition' | 'venue'>): string {
  return [stripLeadingBrackets(entry.exhibition.title ?? ''), entry.exhibition.placeName, entry.venue?.name]
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .join(' ');
}

/** 문자열에서 태그를 찾는다. 순서는 TAGS 순서. */
export function tagsOfText(text: string): Tag[] {
  return TAGS.filter((tag) => TAG_KEYWORDS[tag].some((k) => hit(text, k)));
}

/** 전시의 주제 태그: 키워드 태그 + 시설 기본 태그. 중복 없이 TAGS 순서. */
export function tagsOf(entry: Pick<CatalogEntry, 'exhibition' | 'venue'>): Tag[] {
  const found = tagsOfText(tagText(entry));
  const base = entry.venue ? (VENUE_TAGS[entry.venue.id] ?? []) : [];
  return TAGS.filter((tag) => found.includes(tag) || base.includes(tag));
}

/** 두 태그 목록에 함께 있는 태그. 순서는 TAGS 순서. */
export function sharedTags(a: readonly string[], b: readonly string[]): Tag[] {
  return TAGS.filter((tag) => a.includes(tag) && b.includes(tag));
}
