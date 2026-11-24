/**
 * 사용자 태그 (관람 기록에 사용자가 직접 다는 태그, 교수님 피드백 5번 "리뷰 기반 키워드").
 * 데이터를 인자로 받는 순수 함수만 둔다.
 *
 * 이름 주의: src/lib/tags.ts는 #71의 "주제 태그"(회화·수묵 등, 제목·장소로 자동 분류)다.
 * 이 파일은 사람이 단 태그다. 화면 문구에서도 "태그"(사용자)와 "주제"(자동 분류)로 나눠 부른다.
 *
 * - 기록에는 normalizeTags를 거친 값만 저장하고, 공유에 동의한 기록의 태그만 서버(shared_ratings.tags)에 보낸다.
 * - 서버 검사(최대 5개, 태그당 1~15자)와 같은 기준을 MAX_TAGS·MAX_TAG_LENGTH로 둔다.
 * - 서버 통계(get_tag_stats)는 서로 다른 사용자 MIN_TAG_USERS명 이상이 단 태그만 돌려준다.
 */

/** 기록 한 건에 달 수 있는 태그 수 (서버 검사와 같다) */
export const MAX_TAGS = 5;
/** 태그 한 개 최대 글자 수 (서버 char_length 검사와 같게 코드 포인트로 센다) */
export const MAX_TAG_LENGTH = 15;
/** 서버 통계에 나오는 최소 사용자 수 (서버가 거르지만 화면도 한 번 더 거른다) */
export const MIN_TAG_USERS = 2;
/** 카드·상세 창에 보여 줄 키워드 수 */
export const MAX_KEYWORDS = 4;

/** 입력 칸 아래 추천 칩 */
export const SUGGESTED_TAGS = [
  '사진 찍기 좋음',
  '조용함',
  '아이와 함께',
  '짧게 보기 좋음',
  '설명이 친절함',
  '작품이 많음',
  '데이트',
  '무료라 좋음',
] as const;

/** 서버 태그 통계 한 줄: 한 전시에 이 태그를 단 서로 다른 사용자 수 */
export interface UserTagStat {
  tag: string;
  users: number;
}

/** 카드·상세 창에 보일 키워드. user는 사용자 태그, topic은 #71 주제 태그 */
export type ExhibitKeyword = { kind: 'user'; tag: string; users: number } | { kind: 'topic'; tag: string };

// 한글·영문·숫자·공백·가운뎃점(·) 외 문자
const DISALLOWED = /[^\p{Script=Hangul}A-Za-z0-9\s·]/gu;
// 글자나 숫자가 하나는 있어야 한다 ("···"만 있는 태그는 버린다)
const HAS_WORD = /[\p{L}\p{N}]/u;

/**
 * 태그 하나를 정리한다. 앞뒤 공백·맨 앞 '#' 제거, 허용 외 문자 제거, 공백 여러 개를 하나로, 영문 소문자.
 * 결과가 비었거나 MAX_TAG_LENGTH자를 넘으면 null.
 * (한글 자모가 풀려 들어오는 입력기 대비로 NFC로 먼저 합친다)
 */
export function normalizeTag(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const out = s
    .normalize('NFC')
    .trim()
    .replace(/^#+/, '')
    .replace(DISALLOWED, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (out === '' || !HAS_WORD.test(out)) return null;
  if ([...out].length > MAX_TAG_LENGTH) return null;
  return out;
}

/** 태그 목록을 정리한다. 각각 normalizeTag, 빈 값·중복 제거, 앞에서부터 MAX_TAGS개. 배열이 아니면 빈 배열 */
export function normalizeTags(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const raw of list) {
    const tag = normalizeTag(raw);
    if (tag === null || out.includes(tag)) continue;
    out.push(tag);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

/**
 * 전시 하나에 보일 키워드를 최대 max개 고른다.
 * 서버 사용자 태그(users 많은 순, 같으면 받은 순서)를 먼저 넣고, 모자라면 주제 태그(tagsOf 순서)로 채운다.
 * 같은 글자의 태그는 한 번만 넣는다(사용자 태그가 먼저).
 */
export function pickKeywords(
  userTags: readonly UserTagStat[] | undefined,
  topicTags: readonly string[],
  max: number = MAX_KEYWORDS,
): ExhibitKeyword[] {
  const out: ExhibitKeyword[] = [];
  const seen = new Set<string>();
  const users = [...(userTags ?? [])].sort((a, b) => b.users - a.users);
  for (const { tag, users: n } of users) {
    if (out.length >= max) return out;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push({ kind: 'user', tag, users: n });
  }
  for (const tag of topicTags) {
    if (out.length >= max) return out;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push({ kind: 'topic', tag });
  }
  return out;
}
