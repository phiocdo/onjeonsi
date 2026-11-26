/**
 * 인기 전시·맞춤 전시 추천 v0 (F-09). 데이터를 인자로 받는 순수 함수만 둔다.
 *
 * 화면에서 쓰는 방법:
 *   const ratingOf = (c: Candidate) => getRatingSummary(c.id, c.venueId, { shared: [], seed })
 *   const popular = recommendPopular(candidates, { ratingOf, popularVenueIds })
 *   const { items, filledWithPopular } = recommendPersonal(candidates, { myRecords, interests, seenIds, ratingOf, popularVenueIds })
 *
 * 맞춤 기준은 주제 태그(src/lib/tags.ts의 TAGS·tagsOf)다. 서울시 field(전시/미술 …)는 수집 데이터가 거의 다
 * "전시/미술" 하나라 누구에게나 같은 전시가 나와서 쓰지 않는다. 비슷한 전시(similar.ts)와 같은 태그 함수를 쓴다.
 * 후보·내 기록의 태그는 호출하는 쪽이 tagsOf(entry)로 붙여 넘긴다(카탈로그에서 빠진 기록은 snapshotTags).
 * interests 값 중 TAGS에 없는 것(예전에 저장한 분야 이름 '전시/미술' 등)은 무시한다. 저장 값은 지우지 않는다.
 * 사용자 태그(userTags.ts)는 쓰지 않는다.
 */
import type { Exhibition, Venue } from '../types';
import type { ExhibitionSnapshot } from '../types/records';
import type { RatingRecord, RatingSummary } from './ratings';
import { sharedTags, TAGS, tagsOf, type Tag } from './tags';

/** 화면이 catalog 결과를 이 모양으로 넘긴다 */
export interface Candidate {
  id: string;
  venueId: string | null;
  // 주제 태그 (tagsOf)
  tags: string[];
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

/**
 * 내 기록. VisitRecord는 fromVisitRecord(ratings.ts)로 바꾼 뒤 전시의 주제 태그를 붙여 넘긴다
 * (카탈로그에 있으면 tagsOf(entry), 없으면 snapshotTags(record.exhibition))
 */
export type MyRecord = RatingRecord & { tags?: string[] };

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

/**
 * 카탈로그에서 빠진 기록(끝난 전시)의 주제 태그를 기록할 때 복사해 둔 정보로 구한다.
 * 사본에는 제목·장소 이름(displayVenueName 결과)·시설 id만 있어 그것으로 tagsOf에 넘길 모양을 만든다.
 * 시설에 연결된 전시는 사본의 장소 이름이 시설 이름이라 원래 placeName의 키워드는 놓칠 수 있다.
 */
export function snapshotTags(s: Pick<ExhibitionSnapshot, 'title' | 'venueName' | 'venueId'>): Tag[] {
  const name = s.venueName ?? undefined;
  return tagsOf({
    exhibition: { title: s.title, placeName: name } as Exhibition,
    venue: s.venueId ? ({ id: s.venueId, name: name ?? '' } as Venue) : null,
  });
}

/**
 * 맞춤 기준 태그: 별점 4 이상 기록들의 태그 합집합(fromLiked: true), 없으면 interests 중 TAGS에 있는 것.
 * 순서는 TAGS 순서. 화면의 근거 문구도 이것을 쓴다.
 */
export function personalBasis(myRecords: MyRecord[], interests: string[]): { tags: Tag[]; fromLiked: boolean } {
  const liked = myRecords.filter((r) => r.rating >= 4).flatMap((r) => r.tags ?? []);
  const likedTags = TAGS.filter((t) => liked.includes(t));
  if (likedTags.length > 0) return { tags: likedTags, fromLiked: true };
  // TAGS에 없는 값(예전 분야 이름 등)은 여기서 빠진다
  return { tags: TAGS.filter((t) => interests.includes(t)), fromLiked: false };
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
 * 맞춤 전시: personalBasis의 태그(★4 이상 기록의 주제, 없으면 관심 주제)와 겹치는 태그가 있는 'possible' 전시를
 * 겹치는 태그 수가 많은 순 → 가까운 순으로.
 * - 이미 본 전시(seenIds와 myRecords의 전시)는 뺀다. 태그가 없는 내 기록은 기준 계산에서 빠지고 본 전시로만 쓴다.
 * - 겹치는 태그가 없는 후보(태그가 없는 후보 포함)는 맞춤 대상에서 뺀다(인기 채우기에는 들어갈 수 있다).
 * - reason에는 겹친 태그를 TAGS 순서로 최대 2개, ', '로 잇는다(태그 이름 안에 '·'가 있어서).
 * - 모자라면 recommendPopular 결과로 채우고 filledWithPopular를 true로 한다.
 *   채운 항목의 reason·source는 recommendPopular가 준 그대로다("별점 4.5 (…)" 또는 "근처 인기 전시", source 'popular').
 */
export function recommendPersonal(candidates: Candidate[], opts: PersonalOptions): PersonalResult {
  const limit = Math.max(0, opts.limit ?? 5);
  const { tags: basis, fromLiked } = personalBasis(opts.myRecords, opts.interests);

  const seen = new Set([...opts.seenIds, ...opts.myRecords.map((r) => r.exhibitionId)]);

  const matches = candidates
    .filter((c) => c.result === 'possible' && !seen.has(c.id))
    .map((c) => ({ c, common: sharedTags(basis, c.tags) }))
    .filter((m) => m.common.length > 0)
    .sort((a, b) => b.common.length - a.common.length || byDistance(a.c, b.c))
    .slice(0, limit);

  const items: RecommendCard[] = matches.map(({ c, common }) => {
    const shown = common.slice(0, 2).join(', ');
    return {
      id: c.id,
      reason: fromLiked ? `내가 높게 평가한 전시와 같은 주제: ${shown}` : `관심 주제: ${shown}`,
      source: 'personal',
    };
  });

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
