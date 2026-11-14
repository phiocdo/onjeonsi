import { describe, it, expect } from 'vitest';
import {
  MIN_COUNT,
  isValidReview,
  summarizeReviews,
  type ReviewInput,
} from './stats';

const review = (rating: number, visitMinutes: number): ReviewInput => ({
  rating,
  visitMinutes,
});

describe('stats 집계 로직', () => {
  describe('isValidReview', () => {
    it('1. 별점 경계 검증: 1, 5는 true, 0, 6, 3.5는 false', () => {
      expect(isValidReview(review(1, 60))).toBe(true);
      expect(isValidReview(review(5, 60))).toBe(true);
      expect(isValidReview(review(0, 60))).toBe(false);
      expect(isValidReview(review(6, 60))).toBe(false);
      expect(isValidReview(review(3.5, 60))).toBe(false);
    });

    it('2. 관람 시간 경계 검증: 10, 480은 true, 9, 481은 false', () => {
      expect(isValidReview(review(5, 10))).toBe(true);
      expect(isValidReview(review(5, 480))).toBe(true);
      expect(isValidReview(review(5, 9))).toBe(false);
      expect(isValidReview(review(5, 481))).toBe(false);
    });

    it('3. 비정상 입력(NaN, Infinity, 문자열, null, undefined) 처리', () => {
      expect(isValidReview(review(NaN, 60))).toBe(false);
      expect(isValidReview(review(5, Infinity))).toBe(false);
      expect(isValidReview({ rating: '5', visitMinutes: 60 } as unknown as ReviewInput)).toBe(false);
      expect(isValidReview(null as unknown as ReviewInput)).toBe(false);
      expect(isValidReview(undefined as unknown as ReviewInput)).toBe(false);
    });
  });

  describe('summarizeReviews', () => {
    it('4. 기록 0건 -> count 0, 평균/중앙값 null', () => {
      const stats = summarizeReviews([]);
      expect(stats.count).toBe(0);
      expect(stats.averageRating).toBeNull();
      expect(stats.medianMinutes).toBeNull();
    });

    it(`5. 기록 ${MIN_COUNT - 1}건 -> count는 정확히 세지만 평균/중앙값 null`, () => {
      const stats = summarizeReviews([review(5, 60), review(4, 30)]);
      expect(stats.count).toBe(2);
      expect(stats.averageRating).toBeNull();
      expect(stats.medianMinutes).toBeNull();
    });

    it(`6. 정확히 ${MIN_COUNT}건 -> 평균(4)과 중앙값(60) 정상 도출`, () => {
      const stats = summarizeReviews([
        review(5, 60),
        review(4, 90),
        review(3, 30),
      ]);
      expect(stats.count).toBe(3);
      expect(stats.averageRating).toBe(4);
      expect(stats.medianMinutes).toBe(60);
    });

    it('7. 평균 반올림: 별점 5, 4, 4 -> 평균 4.3', () => {
      const stats = summarizeReviews([
        review(5, 60),
        review(4, 60),
        review(4, 60),
      ]);
      expect(stats.averageRating).toBe(4.3);
    });

    it('8. 중앙값 홀수: 10, 60, 30 -> 정렬 후 가운데인 30', () => {
      const stats = summarizeReviews([
        review(5, 10),
        review(5, 60),
        review(5, 30),
      ]);
      expect(stats.medianMinutes).toBe(30);
    });

    it('9. 중앙값 짝수: 30, 60, 90, 120 -> 60과 90의 평균인 75', () => {
      const stats = summarizeReviews([
        review(5, 30),
        review(5, 60),
        review(5, 90),
        review(5, 120),
      ]);
      expect(stats.medianMinutes).toBe(75);
    });

    it('10. 입력이 정렬되지 않아도 정렬된 입력과 중앙값이 동일', () => {
      const sorted = summarizeReviews([review(5, 10), review(5, 30), review(5, 60)]);
      const unsorted = summarizeReviews([review(5, 60), review(5, 10), review(5, 30)]);
      expect(sorted.medianMinutes).toBe(unsorted.medianMinutes);
    });

    it('11. 유효하지 않은 기록은 count에서 제외됨', () => {
      const stats = summarizeReviews([
        review(5, 60),
        review(5, 60),
        review(5, 60),
        review(99, 999),
      ]);
      expect(stats.count).toBe(3);
      expect(stats.averageRating).not.toBeNull();
    });

    it('12. 원본 배열은 변경되지 않음', () => {
      const input = [review(5, 60), review(4, 10), review(3, 90)];
      const originalCopy = [...input];
      summarizeReviews(input);
      expect(input).toEqual(originalCopy);
      expect(input[0].visitMinutes).toBe(60);
    });

    it('13. 유효한 기록이 모두 없으면 count 0', () => {
      const stats = summarizeReviews([
        review(0, 60),
        review(5, 9),
        null as unknown as ReviewInput,
      ]);
      expect(stats.count).toBe(0);
      expect(stats.averageRating).toBeNull();
      expect(stats.medianMinutes).toBeNull();
    });
  });
});