/**
 * 인기 전시·맞춤 전시 추천 v0 (F-09). 데이터를 인자로 받는 순수 함수만 둔다.
 *
 * 화면에서 쓰는 방법:
 *   const ratingOf = (c: Candidate) => getRatingSummary(c.id, c.venueId, { shared: [], seed })
 *   const popular = recommendPopular(candidates, { ratingOf, popularVenueIds })
 *   const { items, filledWithPopular } = recommendPersonal(candidates, { myRecords, interests, seenIds, ratingOf, popularVenueIds })
 *
 * 주의: 지금 mock Category(현대미술, 회화 …)와 auto.json field(서울시 대분류: 전시/미술, 교육/체험 …)는 일치하지 않음.
 * 실제 데이터는 전시/미술이 대부분이라 맞춤 추천 효과가 작음. 분야 값을 같은 종류로 맞춰 넘기는 것은 호출하는 쪽 책임이다.
 */
import type { RatingRecord, RatingSummary } from './ratings';

/** 화면이 catalog 결과를 이 모양으로 넘긴다 */
export interface Candidate {
  id: string;
  venueId: string | null;
  field: string | null;
  distanceM: number | null;
  result: 'possible' | 'impossible' | 'unknown';
}

export interface RecommendCard {
  id: string;
  reason: string;
  source: 'personal' | 'popular';
}

export interface PersonalResult {
  items: RecommendCard[];
  // 맞춤 전시가 모자라 인기 전시로 채웠으면 true
  filledWithPopular: boolean;
}

/** 내 기록. VisitRecord는 fromVisitRecord(ratings.ts)로 바꾼 뒤 record.exhibition.field를 붙여 넘긴다 */
export type MyRecord = RatingRecord & { field?: string | null };

export const POPULAR_REASON = '근처 인기 전시';

export interface PopularOptions {
  ratingOf: (c: Candidate) => RatingSummary;
  popularVenueIds: string[];
  limit?: number;
  // 빼고 고를 전시 id (맞춤 추천이 채울 때 이미 고른 것·본 것을 넘긴다)
  excludeIds?: string[];
}

export interface PersonalOptions {
  myRecords: MyRecord[];
  interests: string[];
  seenIds: string[];
  ratingOf: (c: Candidate) => RatingSummary;
  popularVenueIds: string[];
  limit?: number;
}

/** 가까운 순. 거리가 null이면 맨 뒤 */
function byDistance(a: Candidate, b: Candidate): number {
  if (a.distanceM === null && b.distanceM === null) return 0;
  if (a.distanceM === null) return 1;
  if (b.distanceM === null) return -1;
  return a.distanceM - b.distanceM;
}

function hasField(field: string | null | undefined): field is string {
  return typeof field === 'string' && field.trim() !== '';
}

/**
 * 인기 전시: 판정이 'possible'인 전시 중
 * ① 별점 집계가 있는 것(level !== 'none')을 평균 별점 높은 순 → 평가 수 많은 순 → 가까운 순
 * ② 나머지를 popularVenueIds 순서(목록에 없는 시설은 뒤) → 가까운 순으로 채워 limit개
 */
export function recommendPopular(candidates: Candidate[], opts: PopularOptions): RecommendCard[] {
  const limit = opts.limit ?? 5;
  const exclude = new Set(opts.excludeIds ?? []);
  const pool = candidates.filter((c) => c.result === 'possible' && !exclude.has(c.id));

  const rated: Array<{ c: Candidate; s: RatingSummary }> = [];
  const rest: Candidate[] = [];
  for (const c of pool) {
    const s = opts.ratingOf(c);
    if (s.level !== 'none' && s.averageRating !== null) rated.push({ c, s });
    else rest.push(c);
  }

  rated.sort(
    (a, b) =>
      (b.s.averageRating ?? 0) - (a.s.averageRating ?? 0) ||
      b.s.count - a.s.count ||
      byDistance(a.c, b.c),
  );

  const rank = (c: Candidate) => {
    const i = c.venueId ? opts.popularVenueIds.indexOf(c.venueId) : -1;
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  rest.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra < rb ? -1 : 1;
    return byDistance(a, b);
  });

  const cards: RecommendCard[] = [
    ...rated.map(({ c, s }) => ({
      id: c.id,
      reason: `별점 ${(s.averageRating ?? 0).toFixed(1)} (${s.label})`,
      source: 'popular' as const,
    })),
    ...rest.map((c) => ({ id: c.id, reason: POPULAR_REASON, source: 'popular' as const })),
  ];
  return cards.slice(0, Math.max(0, limit));
}

/**
 * 맞춤 전시: 내가 별점 4 이상 준 기록의 분야(없으면 interests)와 같은 분야의 'possible' 전시를 가까운 순으로.
 * - 이미 본 전시(seenIds와 myRecords의 전시)는 뺀다. field가 없는 내 기록은 분야 계산에서 빼고 본 전시로만 쓴다.
 * - 분야가 없는 후보는 맞춤 대상에서 뺀다(인기 채우기에는 들어갈 수 있다).
 * - 모자라면 recommendPopular 결과로 채우고 filledWithPopular를 true로 한다.
 *   채운 항목의 reason·source는 recommendPopular가 준 그대로다("별점 4.5 (…)" 또는 "근처 인기 전시", source 'popular').
 */
export function recommendPersonal(candidates: Candidate[], opts: PersonalOptions): PersonalResult {
  const limit = Math.max(0, opts.limit ?? 5);

  const likedFields = unique(
    opts.myRecords.filter((r) => r.rating >= 4 && hasField(r.field)).map((r) => r.field as string),
  );
  const fromLiked = likedFields.length > 0;
  const fields = fromLiked ? likedFields : unique(opts.interests.filter(hasField));

  const seen = new Set([...opts.seenIds, ...opts.myRecords.map((r) => r.exhibitionId)]);

  const matches = candidates
    .filter(
      (c) => c.result === 'possible' && hasField(c.field) && fields.includes(c.field) && !seen.has(c.id),
    )
    .sort(byDistance)
    .slice(0, limit);

  const items: RecommendCard[] = matches.map((c) => ({
    id: c.id,
    reason: fromLiked ? `내가 높게 평가한 ${c.field} 분야` : `관심 분야 ${c.field}`,
    source: 'personal',
  }));

  let filledWithPopular = false;
  if (items.length < limit) {
    const fill = recommendPopular(candidates, {
      ratingOf: opts.ratingOf,
      popularVenueIds: opts.popularVenueIds,
      limit: limit - items.length,
      excludeIds: [...seen, ...items.map((i) => i.id)],
    });
    if (fill.length > 0) {
      filledWithPopular = true;
      items.push(...fill);
    }
  }

  return { items, filledWithPopular };
}

function unique<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}
