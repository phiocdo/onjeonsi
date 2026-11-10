export const MIN_COUNT = 3;
export const RATING_MIN = 1;
export const RATING_MAX = 5;
export const MINUTES_MIN = 10;
export const MINUTES_MAX = 480;

export interface ReviewInput {
  rating: number;
  visitMinutes: number;
}

export interface ReviewStats {
  count: number;
  averageRating: number | null;
  medianMinutes: number | null;
}

/**
 * 리뷰 데이터 유효성 검증
 * - rating: 1~5 정수
 * - visitMinutes: 10~480분 범위 유한한 숫자
 */
export function isValidReview(r: ReviewInput): boolean {
  if (!r || typeof r !== 'object') return false;
  const { rating, visitMinutes } = r;

  const isRatingValid =
    typeof rating === 'number' &&
    Number.isInteger(rating) &&
    rating >= RATING_MIN &&
    rating <= RATING_MAX;

  const isMinutesValid =
    typeof visitMinutes === 'number' &&
    Number.isFinite(visitMinutes) &&
    visitMinutes >= MINUTES_MIN &&
    visitMinutes <= MINUTES_MAX;

  return isRatingValid && isMinutesValid;
}

/**
 * 리뷰 목록 집계 요약
 * - 유효한 리뷰만 선별
 * - MIN_COUNT(3건) 미만 시 평균/중앙값 null
 * - 평균 별점: 소수 첫째 자리 반올림
 * - 중앙 관람 시간: 짝수 개는 중앙 2개 평균, 홀수 개는 정가운데 값
 */
export function summarizeReviews(reviews: ReviewInput[]): ReviewStats {
  if (!Array.isArray(reviews)) {
    return { count: 0, averageRating: null, medianMinutes: null };
  }

  const validReviews = reviews.filter(isValidReview);
  const count = validReviews.length;

  if (count < MIN_COUNT) {
    return { count, averageRating: null, medianMinutes: null };
  }

  const sumRating = validReviews.reduce((acc, r) => acc + r.rating, 0);
  const averageRating = Math.round((sumRating / count) * 10) / 10;

  const minutes = validReviews.map((r) => r.visitMinutes).sort((a, b) => a - b);
  const mid = Math.floor(count / 2);

  const medianMinutes =
    count % 2 === 0
      ? (minutes[mid - 1] + minutes[mid]) / 2
      : minutes[mid];

  return { count, averageRating, medianMinutes };
}