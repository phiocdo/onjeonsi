import { describe, it, expect } from 'vitest';
import {
  fromArchiveEntry,
  fromSeedReview,
  getRatingSummary,
  type RatingRecord,
} from './ratings';

const rec = (
  exhibitionId: string,
  venueId: string | null,
  rating: number,
  visitMinutes: number,
): RatingRecord => ({ exhibitionId, venueId, rating, visitMinutes });

describe('getRatingSummary 단계', () => {
  it('① shared의 그 전시가 3건 이상이면 exhibition', () => {
    const shared = [rec('e1', 'v1', 5, 60), rec('e1', 'v1', 4, 90), rec('e1', 'v1', 4, 30)];
    expect(getRatingSummary('e1', 'v1', { shared })).toEqual({
      level: 'exhibition',
      count: 3,
      averageRating: 4.3,
      medianMinutes: 60,
      label: '이 전시 3명',
    });
  });

  it('② 그 전시가 모자라면 shared의 그 시설', () => {
    const shared = [rec('e1', 'v1', 5, 60), rec('e2', 'v1', 3, 40), rec('e3', 'v1', 4, 50)];
    const s = getRatingSummary('e1', 'v1', { shared });
    expect(s.level).toBe('venue');
    expect(s.label).toBe('이 시설 3명');
    expect(s.averageRating).toBe(4);
    expect(s.medianMinutes).toBe(50);
  });

  it('③ shared가 모자라면 seed의 그 전시', () => {
    const seed = [rec('e1', 'v1', 3, 20), rec('e1', 'v1', 3, 40), rec('e1', 'v1', 4, 60)];
    const s = getRatingSummary('e1', 'v1', { shared: [], seed });
    expect(s).toMatchObject({ level: 'seed', count: 3, label: '예시 기록', averageRating: 3.3 });
  });

  it('③ seed의 그 전시가 없으면 seed의 그 시설', () => {
    const seed = [rec('e2', 'v1', 5, 20), rec('e3', 'v1', 5, 40), rec('e4', 'v1', 4, 60)];
    expect(getRatingSummary('e1', 'v1', { seed })).toMatchObject({ level: 'seed', count: 3 });
  });

  it('④ 그 밖이면 기록 부족', () => {
    expect(getRatingSummary('e1', 'v1', {})).toEqual({
      level: 'none',
      count: 0,
      averageRating: null,
      medianMinutes: null,
      label: '기록 부족',
    });
  });

  it('venueId가 없으면 시설 단계는 건너뛴다', () => {
    const shared = [rec('e2', null, 5, 60), rec('e3', null, 5, 60), rec('e4', null, 5, 60)];
    expect(getRatingSummary('e1', null, { shared }).level).toBe('none');
  });
});

describe('3건 경계', () => {
  it('shared 전시 2건이면 다음 단계(시설)로 간다', () => {
    const shared = [rec('e1', 'v1', 5, 60), rec('e1', 'v1', 5, 60), rec('e2', 'v1', 1, 60)];
    expect(getRatingSummary('e1', 'v1', { shared }).level).toBe('venue');
  });

  it('shared 시설 2건이면 seed로 간다', () => {
    const shared = [rec('e1', 'v1', 5, 60), rec('e2', 'v1', 5, 60)];
    const seed = [rec('e1', 'v1', 2, 60), rec('e1', 'v1', 2, 60), rec('e1', 'v1', 2, 60)];
    expect(getRatingSummary('e1', 'v1', { shared, seed }).level).toBe('seed');
  });

  it('seed 2건이면 기록 부족', () => {
    const seed = [rec('e1', 'v1', 2, 60), rec('e1', 'v1', 2, 60)];
    expect(getRatingSummary('e1', 'v1', { seed }).level).toBe('none');
  });
});

describe('값 검증과 계산', () => {
  it('범위 밖 기록은 버리고 건수에서도 뺀다', () => {
    const shared = [
      rec('e1', 'v1', 5, 60),
      rec('e1', 'v1', 4, 60),
      rec('e1', 'v1', 0, 60), // 별점 범위 밖
      rec('e1', 'v1', 6, 60), // 별점 범위 밖
      rec('e1', 'v1', 4.5, 60), // 정수 아님
      rec('e1', 'v1', 4, 9), // 시간 범위 밖
      rec('e1', 'v1', 4, 481), // 시간 범위 밖
    ];
    expect(getRatingSummary('e1', 'v1', { shared }).level).toBe('none');
    const s = getRatingSummary('e1', 'v1', { shared: [...shared, rec('e1', 'v1', 3, 480)] });
    expect(s).toMatchObject({ level: 'exhibition', count: 3, averageRating: 4 });
  });

  it('평균 별점은 소수 첫째 자리로 반올림', () => {
    const shared = [rec('e1', null, 5, 60), rec('e1', null, 5, 60), rec('e1', null, 4, 60)];
    expect(getRatingSummary('e1', null, { shared }).averageRating).toBe(4.7);
  });

  it('중앙값: 홀수는 가운데, 짝수는 가운데 두 값의 평균', () => {
    const odd = [rec('e1', null, 3, 100), rec('e1', null, 3, 10), rec('e1', null, 3, 50)];
    expect(getRatingSummary('e1', null, { shared: odd }).medianMinutes).toBe(50);
    const even = [...odd, rec('e1', null, 3, 70)];
    expect(getRatingSummary('e1', null, { shared: even }).medianMinutes).toBe(60);
  });

  it('입력을 바꾸지 않는다', () => {
    const shared = [rec('e1', 'v1', 5, 90), rec('e1', 'v1', 1, 30), rec('e1', 'v1', 3, 60)];
    const seed = [rec('e2', 'v1', 4, 40)];
    const before = JSON.stringify({ shared, seed });
    getRatingSummary('e1', 'v1', { shared, seed });
    expect(JSON.stringify({ shared, seed })).toBe(before);
  });
});

describe('변환 함수', () => {
  it('fromSeedReview는 필드를 그대로 옮긴다', () => {
    expect(
      fromSeedReview({ exhibitionId: 'e1', venueId: 'venue-a', rating: 4, visitMinutes: 70 }),
    ).toEqual({ exhibitionId: 'e1', venueId: 'venue-a', rating: 4, visitMinutes: 70 });
  });

  it('fromArchiveEntry는 exhibitId를 문자열로, time을 visitMinutes로 옮긴다', () => {
    expect(fromArchiveEntry({ exhibitId: 18, rating: 5, time: 80 })).toEqual({
      exhibitionId: '18',
      venueId: null,
      rating: 5,
      visitMinutes: 80,
    });
  });
});
