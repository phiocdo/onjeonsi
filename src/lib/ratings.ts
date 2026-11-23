/**
 * 공유 별점·관람 시간 읽기 (F-08). 데이터를 인자로 받는 순수 함수만 둔다.
 *
 * 화면에서 쓰는 방법 (OneExhibit.tsx, Archive.tsx):
 *   const stats = useSyncExternalStore(subscribeStats, getCachedStats)   // src/lib/sharedRatings.ts (서버 집계)
 *   const s = getRatingSummary(ex.id, venueId, { stats, seed: SEED_RECORDS }) // src/lib/seed.ts
 *   s.level !== 'none' ? `★ ${s.averageRating} · ${s.medianMinutes}분 · ${s.label}` : s.label
 *
 * 읽기 순서: 서버 전시 통계(stats) → 공유 기록(shared)의 그 전시 → 서버 시설 통계 → 공유 기록의 그 시설
 *   → 시드(seed)의 그 전시, 없으면 그 시설 → 기록 부족. 자세한 기준은 getRatingSummary 주석.
 *
 * - stats: 서버(shared_ratings)의 전시별·시설별 사전 집계. 사용자가 익명 공유한 기록이 모두 들어가므로
 *   이 브라우저에서 내가 공유한 기록도 포함된다(따로 더하지 않는다).
 * - shared: 개별 공유 기록 목록. 지금 화면은 넘기지 않으며, 집계 전 기록을 직접 넣는 경우(테스트 등)에 쓴다.
 * - 내 기록(VisitRecord)은 집계에 넣지 않는다. fromVisitRecord는 추천(recommend.ts)의 myRecords용이다.
 *   (공유한 내 기록은 위처럼 서버 통계로만 들어간다)
 * - 집계 계산과 3건 기준은 src/engine/stats.ts(summarizeReviews, MIN_COUNT)를 그대로 쓴다.
 */
import {
  MIN_COUNT,
  MINUTES_MAX,
  MINUTES_MIN,
  RATING_MAX,
  RATING_MIN,
  isValidReview,
  summarizeReviews,
} from '../engine/stats';
import type { VisitRecord } from '../types/records';

/** 집계·추천에 넣는 기록 한 건 */
export interface RatingRecord {
  exhibitionId: string;
  venueId?: string | null;
  // 1~5 정수
  rating: number;
  // 실제 관람 시간(분), 10~480
  visitMinutes: number;
}

export type RatingLevel = 'exhibition' | 'venue' | 'seed' | 'none';

export interface RatingSummary {
  level: RatingLevel;
  // level이 'none'이면 0
  count: number;
  // 소수 첫째 자리. level이 'none'이면 null
  averageRating: number | null;
  medianMinutes: number | null;
  // "이 전시 기록 12건" / "이 시설 기록 28건" / "예시 기록" / "기록 부족"
  label: string;
}

/** 이미 집계된 통계 한 항목 (서버 RPC 등 외부 집계 결과) */
export interface AggregatedStat {
  count: number;
  averageRating: number;
  medianMinutes: number;
}

/** 전시별·시설별 사전 집계 통계 */
export interface SharedRatingStats {
  exhibitions: ReadonlyMap<string, AggregatedStat>;
  venues: ReadonlyMap<string, AggregatedStat>;
}

export interface RatingSources {
  // 이미 집계된 공유 통계 (서버 RPC 결과)
  stats?: SharedRatingStats;
  // 여러 사람의 공유 기록 (개별 기록 목록)
  shared?: readonly RatingRecord[];
  // 정적 시드 기록 (data/reviews/seed.json, src/lib/seed.ts의 SEED_RECORDS)
  seed?: readonly RatingRecord[];
}

/** 공유 평가 시드(data/reviews/seed.json, PR #33의 SharedReview)의 원소 형식 */
export interface SeedReviewInput {
  exhibitionId: string;
  venueId: string;
  rating: number;
  visitMinutes: number;
}

/** 시드 형식 → 기록 형식 */
export function fromSeedReview(r: SeedReviewInput): RatingRecord {
  return {
    exhibitionId: r.exhibitionId,
    venueId: r.venueId,
    rating: r.rating,
    visitMinutes: r.visitMinutes,
  };
}

/**
 * 아카이브 기록(VisitRecord) → 기록 형식. 추천의 내 기록(myRecords)용이며 공유 집계에는 넣지 않는다.
 * - venueId는 기록할 때 복사해 둔 전시 정보에서 가져온다.
 */
export function fromVisitRecord(r: Pick<VisitRecord, 'exhibitionId' | 'exhibition' | 'rating' | 'visitMinutes'>): RatingRecord {
  return {
    exhibitionId: r.exhibitionId,
    venueId: r.exhibition.venueId,
    rating: r.rating,
    visitMinutes: r.visitMinutes,
  };
}

/**
 * 사전 집계 통계 한 항목이 쓸 만한지: count는 MIN_COUNT 이상 정수, 평균 별점 1~5, 관람 시간 중앙값 10~480분.
 * sharedRatings.ts의 서버 응답 변환(parseStatsRows)도 이 검사를 같이 쓴다.
 */
export function isValidAggregatedStat(stat: unknown): stat is AggregatedStat {
  if (!stat || typeof stat !== 'object') return false;
  const { count, averageRating, medianMinutes } = stat as Record<string, unknown>;
  return (
    typeof count === 'number' &&
    Number.isInteger(count) &&
    count >= MIN_COUNT &&
    typeof averageRating === 'number' &&
    Number.isFinite(averageRating) &&
    averageRating >= RATING_MIN &&
    averageRating <= RATING_MAX &&
    typeof medianMinutes === 'number' &&
    Number.isFinite(medianMinutes) &&
    medianMinutes >= MINUTES_MIN &&
    medianMinutes <= MINUTES_MAX
  );
}

function fromAggregated(level: 'exhibition' | 'venue', stat: AggregatedStat): RatingSummary {
  const averageRating = Math.round(stat.averageRating * 10) / 10;
  const medianMinutes = Math.round(stat.medianMinutes * 10) / 10;
  const label =
    level === 'exhibition' ? `이 전시 기록 ${stat.count}건` : `이 시설 기록 ${stat.count}건`;
  return { level, count: stat.count, averageRating, medianMinutes, label };
}

function summarize(level: Exclude<RatingLevel, 'none'>, records: RatingRecord[]): RatingSummary {
  const { count, averageRating, medianMinutes } = summarizeReviews(records);
  const label =
    level === 'exhibition'
      ? `이 전시 기록 ${count}건`
      : level === 'venue'
        ? `이 시설 기록 ${count}건`
        : '예시 기록';
  return { level, count, averageRating, medianMinutes, label };
}

const NONE: RatingSummary = {
  level: 'none',
  count: 0,
  averageRating: null,
  medianMinutes: null,
  label: '기록 부족',
};

/**
 * 한 전시의 별점·관람 시간 요약. 읽기 순서:
 * ① 서버 전시 통계(stats.exhibitions) → ② shared의 그 전시 → ③ 서버 시설 통계(stats.venues) → ④ shared의 그 시설
 * → ⑤ seed의 그 전시 → ⑥ seed의 그 시설 → ⑦ 기록 부족.
 * 서버 통계는 isValidAggregatedStat(건수 MIN_COUNT 이상, 값 범위)를 통과할 때, 기록 목록(shared·seed)은
 * 유효한 기록(별점 1~5 정수, 관람 시간 10~480분)이 MIN_COUNT(3)건 이상일 때만 쓴다.
 */
export function getRatingSummary(
  exhibitionId: string,
  venueId: string | null | undefined,
  sources: RatingSources,
): RatingSummary {
  const statExhibition = sources.stats?.exhibitions.get(exhibitionId);
  if (isValidAggregatedStat(statExhibition)) return fromAggregated('exhibition', statExhibition);

  const shared = (sources.shared ?? []).filter(isValidReview);
  const seed = (sources.seed ?? []).filter(isValidReview);
  const byExhibition = (r: RatingRecord) => r.exhibitionId === exhibitionId;
  const byVenue = (r: RatingRecord) => !!venueId && r.venueId === venueId;

  const sharedExhibition = shared.filter(byExhibition);
  if (sharedExhibition.length >= MIN_COUNT) return summarize('exhibition', sharedExhibition);

  const statVenue = venueId ? sources.stats?.venues.get(venueId) : undefined;
  if (isValidAggregatedStat(statVenue)) return fromAggregated('venue', statVenue);

  const sharedVenue = shared.filter(byVenue);
  if (sharedVenue.length >= MIN_COUNT) return summarize('venue', sharedVenue);

  const seedExhibition = seed.filter(byExhibition);
  if (seedExhibition.length >= MIN_COUNT) return summarize('seed', seedExhibition);

  const seedVenue = seed.filter(byVenue);
  if (seedVenue.length >= MIN_COUNT) return summarize('seed', seedVenue);

  return { ...NONE };
}
