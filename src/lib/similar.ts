/**
 * 비슷한 전시 고르기 (F-12). 데이터를 인자로 받는 순수 함수만 둔다.
 *
 * - target이 비전시 행사(isExhibitionLike가 false)면 빈 배열 → 화면은 칸을 숨긴다.
 * - 후보: 자기 자신이 아니고, 전시 행사이고, 오늘 진행 중인 전시(start <= today <= end, 기간이 날짜여야 함)
 * - 점수: target과 겹치는 주제 태그 수. 0이면 후보가 아니다.
 *   target에 태그가 하나도 없으면 같은 시설(venue id 같음) 전시를 대신 후보로 쓴다.
 * - 같은 점수 안에서: 같은 시설 → 가까운 순(좌표 없으면 뒤로) → 종료일 이른 순 → 제목 순 → id 순
 * - 판정(가능/불가)은 고르는 기준에 넣지 않는다.
 */
import type { CatalogEntry } from './catalog';
import { calculateDistance, type Coordinate } from '../engine/distance';
import { tagsOf } from './tags';

export interface SimilarOptions {
  /** 서울 기준 오늘 YYYY-MM-DD */
  today: string;
  limit?: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 비슷한 전시로 보지 않는 field(서울시 대분류).
 * auto.json에 실제로 있는 값(2026-11-22): 전시/미술 35, 교육/체험 7, 콘서트 3, 영화 2, 국악 1, 축제-기타 1
 * 이 중 전시/미술만 전시 행사로 본다. 아직 데이터에 없는 공연·행사 분류도 미리 넣어 둔다.
 */
export const NON_EXHIBITION_FIELDS: ReadonlySet<string> = new Set([
  '교육/체험',
  '콘서트',
  '영화',
  '국악',
  '축제-기타',
  '축제-문화/예술',
  '축제-전통/역사',
  '축제-시민화합',
  '축제-자연/경관',
  '클래식',
  '독주/독창회',
  '연극',
  '뮤지컬/오페라',
  '무용',
]);

/** 전시 행사인지. field가 비전시 분류면 false. field가 없으면 판단할 근거가 없으므로 전시로 본다. */
export function isExhibitionLike(entry: CatalogEntry): boolean {
  const field = entry.exhibition.field?.trim();
  return !field || !NON_EXHIBITION_FIELDS.has(field);
}

/** 오늘 진행 중인지: start <= today <= end. 둘 다 YYYY-MM-DD여야 한다. */
function isOngoing(entry: CatalogEntry, today: string): boolean {
  const { start, end } = entry.exhibition;
  if (typeof start !== 'string' || !DATE.test(start)) return false;
  if (typeof end !== 'string' || !DATE.test(end)) return false;
  return start <= today && today <= end;
}

function coord(lat: unknown, lng: unknown): Coordinate | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // 0은 값 없음을 채운 경우로 본다 (matchVenue와 같은 규칙)
  if (lat === 0 || lng === 0) return null;
  return { lat, lng };
}

/** 거리 기준 좌표: 연결된 시설 좌표 → 전시 좌표 → null */
function coordOf(entry: CatalogEntry): Coordinate | null {
  return (
    (entry.venue ? coord(entry.venue.lat, entry.venue.lng) : null) ??
    coord(entry.exhibition.lat, entry.exhibition.lng)
  );
}

function venueIdOf(entry: CatalogEntry): string | null {
  return entry.venue?.id ?? null;
}

interface Scored {
  entry: CatalogEntry;
  score: number;
  sameVenue: boolean;
  distance: number | null;
}

function compare(a: Scored, b: Scored): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.sameVenue !== b.sameVenue) return a.sameVenue ? -1 : 1;
  if (a.distance !== b.distance) {
    if (a.distance === null) return 1;
    if (b.distance === null) return -1;
    return a.distance - b.distance;
  }
  const ea = a.entry.exhibition;
  const eb = b.entry.exhibition;
  if (ea.end !== eb.end) return ea.end < eb.end ? -1 : 1;
  if (ea.title !== eb.title) return ea.title < eb.title ? -1 : 1;
  if (ea.id !== eb.id) return ea.id < eb.id ? -1 : 1;
  return 0;
}

export function similarExhibitions(
  target: CatalogEntry,
  catalog: readonly CatalogEntry[],
  { today, limit = 4 }: SimilarOptions,
): CatalogEntry[] {
  if (limit <= 0) return [];
  if (!isExhibitionLike(target)) return [];

  const targetId = target.exhibition.id;
  const targetTags = tagsOf(target);
  const targetVenue = venueIdOf(target);
  const origin = coordOf(target);
  // 태그가 없고 시설도 없으면 고를 기준이 없다
  if (targetTags.length === 0 && targetVenue === null) return [];

  const scored: Scored[] = [];
  for (const entry of catalog) {
    if (entry.exhibition.id === targetId) continue;
    if (!isExhibitionLike(entry) || !isOngoing(entry, today)) continue;

    const sameVenue = targetVenue !== null && venueIdOf(entry) === targetVenue;
    let score: number;
    if (targetTags.length > 0) {
      const tags = tagsOf(entry);
      score = targetTags.filter((t) => tags.includes(t)).length;
      if (score === 0) continue;
    } else {
      if (!sameVenue) continue;
      score = 0;
    }

    const c = coordOf(entry);
    const distance = origin && c ? calculateDistance(origin, c) : null;
    scored.push({ entry, score, sameVenue, distance });
  }

  return scored.sort(compare).slice(0, limit).map((s) => s.entry);
}
