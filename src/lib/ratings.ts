/**
 * 공유 별점·관람 시간 읽기 (F-08). 데이터를 인자로 받는 순수 함수만 둔다.
 *
 * 화면에서 쓰는 방법:
 *   const seed = seedJson.map(fromSeedReview)            // data/reviews/seed.json
 *   const s = getRatingSummary(ex.id, venueId, { shared: [], seed })
 *   s.level !== 'none' ? `★ ${s.averageRating} · ${s.medianMinutes}분 · ${s.label}` : s.label
 *
 * - shared: 여러 사람의 공유 기록. 지금은 서버가 없어 빈 배열이고, 나중에 서버 집계가 생기면 여기에 넣는다.
 * - 내 기록(ArchiveEntry)은 집계에 넣지 않는다. fromArchiveEntry는 추천(recommend.ts)의 myRecords용이다.
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
  shared?: RatingRecord[];
  // 정적 시드 기록 (data/reviews/seed.json)
  seed?: RatingRecord[];
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

/** src/mock/exhibits.ts의 ArchiveEntry 중 여기서 쓰는 필드 */
export interface ArchiveEntryInput {
  exhibitId: number | string;
  rating: number;
  time: number;
}

/**
 * ArchiveEntry → 기록 형식. 추천의 내 기록(myRecords)용이며 공유 집계에는 넣지 않는다.
 * - exhibitId는 숫자라 문자열로 바꾼다. 지금 값은 mock 전시 번호라 실제 전시(auto.json의 id)와 연결되지 않는다.
 *   기록을 실제 전시 id로 옮기는 것은 화면 작업(F-06)이다.
 * - time 필드를 visitMinutes로 옮긴다. ArchiveEntry에는 시설 정보가 없어 venueId는 null이다.
 */
export function fromArchiveEntry(e: ArchiveEntryInput): RatingRecord {
  return {
    exhibitionId: String(e.exhibitId),
    venueId: null,
    rating: e.rating,
    visitMinutes: e.time,
  };
}

function isValidAggregatedStat(stat: AggregatedStat | undefined): stat is AggregatedStat {
  if (!stat || typeof stat !== 'object') return false;
  const { count, averageRating, medianMinutes } = stat;
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
 * ① 공유 통계(stats)/shared의 그 전시 → ② 공유 통계(stats)/shared의 그 시설 → ③ seed의 그 전시, 없으면 그 시설 → ④ 기록 부족.
 * 각 단계는 유효한 기록(별점 1~5 정수, 관람 시간 10~480분)이 MIN_COUNT(3)건 이상일 때만 쓴다.
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
