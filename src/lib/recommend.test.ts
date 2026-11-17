import { describe, it, expect } from 'vitest';
import { recommendPersonal, recommendPopular, type Candidate, type MyRecord } from './recommend';
import type { RatingSummary } from './ratings';

const cand = (
  id: string,
  distanceM: number | null,
  extra: Partial<Candidate> = {},
): Candidate => ({ id, venueId: null, field: null, distanceM, result: 'possible', ...extra });

const NONE: RatingSummary = {
  level: 'none',
  count: 0,
  averageRating: null,
  medianMinutes: null,
  label: '기록 부족',
};

const rated = (avg: number, count: number): RatingSummary => ({
  level: 'exhibition',
  count,
  averageRating: avg,
  medianMinutes: 60,
  label: `이 전시 ${count}명`,
});

const ratingFrom = (table: Record<string, RatingSummary>) => (c: Candidate) => table[c.id] ?? NONE;
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('recommendPopular', () => {
  it('possible만 고른다', () => {
    const cs = [
      cand('a', 100),
      cand('b', 200, { result: 'impossible' }),
      cand('c', 300, { result: 'unknown' }),
    ];
    expect(ids(recommendPopular(cs, { ratingOf: () => NONE, popularVenueIds: [] }))).toEqual(['a']);
  });

  it('별점 높은 순 → 평가 수 많은 순 → 가까운 순, reason에 label', () => {
    const cs = [cand('a', 100), cand('b', 50), cand('c', 300), cand('d', 10)];
    const ratingOf = ratingFrom({ a: rated(4.0, 5), b: rated(4.5, 3), c: rated(4.0, 10), d: rated(4.0, 5) });
    const out = recommendPopular(cs, { ratingOf, popularVenueIds: [] });
    expect(ids(out)).toEqual(['b', 'c', 'd', 'a']);
    expect(out[0]).toEqual({ id: 'b', reason: '별점 4.5 (이 전시 3명)', source: 'popular' });
    expect(out[1].reason).toBe('별점 4.0 (이 전시 10명)');
  });

  it('별점 근거가 먼저, 나머지는 인기 시설 순 → 가까운 순, 목록에 없는 시설은 뒤', () => {
    const cs = [
      cand('x', 10, { venueId: 'venue-z' }),
      cand('p2', 500, { venueId: 'venue-b' }),
      cand('p1far', 900, { venueId: 'venue-a' }),
      cand('p1near', 100, { venueId: 'venue-a' }),
      cand('r', 999, { venueId: 'venue-z' }),
    ];
    const out = recommendPopular(cs, {
      ratingOf: ratingFrom({ r: rated(3.0, 3) }),
      popularVenueIds: ['venue-a', 'venue-b'],
    });
    expect(ids(out)).toEqual(['r', 'p1near', 'p1far', 'p2', 'x']);
    expect(out[1].reason).toBe('근처 인기 전시');
  });

  it('limit (기본 5)', () => {
    const cs = Array.from({ length: 8 }, (_, i) => cand(`e${i}`, i));
    expect(recommendPopular(cs, { ratingOf: () => NONE, popularVenueIds: [] })).toHaveLength(5);
    expect(recommendPopular(cs, { ratingOf: () => NONE, popularVenueIds: [], limit: 4 })).toHaveLength(4);
  });

  it('거리가 null인 후보는 맨 뒤', () => {
    const cs = [cand('n', null), cand('far', 5000), cand('near', 10)];
    expect(ids(recommendPopular(cs, { ratingOf: () => NONE, popularVenueIds: [] }))).toEqual([
      'near',
      'far',
      'n',
    ]);
  });

  it('입력 배열을 바꾸지 않는다', () => {
    const cs = [cand('b', 200), cand('a', 100)];
    recommendPopular(cs, { ratingOf: () => NONE, popularVenueIds: [] });
    expect(ids(cs)).toEqual(['b', 'a']);
  });
});

const my = (exhibitionId: string, rating: number, field?: string | null): MyRecord => ({
  exhibitionId,
  venueId: null,
  rating,
  visitMinutes: 60,
  field,
});

describe('recommendPersonal', () => {
  const base = { ratingOf: () => NONE, popularVenueIds: [] as string[], seenIds: [] as string[] };

  it('별점 4 이상 기록의 분야와 같은 전시를 가까운 순으로', () => {
    const cs = [
      cand('a', 300, { field: '회화' }),
      cand('b', 100, { field: '회화' }),
      cand('c', 50, { field: '사진' }),
      cand('d', 10, { field: '조각' }),
    ];
    const out = recommendPersonal(cs, {
      ...base,
      myRecords: [my('m1', 5, '회화'), my('m2', 4, '조각'), my('m3', 3, '사진')],
      interests: ['사진'],
      limit: 3,
    });
    expect(out.items).toEqual([
      { id: 'd', reason: '내가 높게 평가한 조각 분야', source: 'personal' },
      { id: 'b', reason: '내가 높게 평가한 회화 분야', source: 'personal' },
      { id: 'a', reason: '내가 높게 평가한 회화 분야', source: 'personal' },
    ]);
    expect(out.filledWithPopular).toBe(false);
  });

  it('본 전시(seenIds와 myRecords)는 뺀다', () => {
    const cs = [cand('a', 1, { field: '회화' }), cand('b', 2, { field: '회화' }), cand('c', 3, { field: '회화' })];
    const out = recommendPersonal(cs, {
      ...base,
      myRecords: [my('a', 5, '회화')],
      seenIds: ['b'],
      interests: [],
      limit: 1,
    });
    expect(ids(out.items)).toEqual(['c']);
  });

  it('possible만 고른다', () => {
    const cs = [cand('a', 1, { field: '회화', result: 'unknown' }), cand('b', 2, { field: '회화' })];
    const out = recommendPersonal(cs, { ...base, myRecords: [], interests: ['회화'], limit: 1 });
    expect(ids(out.items)).toEqual(['b']);
  });

  it('높게 평가한 기록이 없으면 관심 분야', () => {
    const cs = [cand('a', 1, { field: '사진' }), cand('b', 2, { field: '회화' })];
    const out = recommendPersonal(cs, {
      ...base,
      myRecords: [my('m1', 3, '회화')],
      interests: ['사진'],
      limit: 1,
    });
    expect(out.items).toEqual([{ id: 'a', reason: '관심 분야 사진', source: 'personal' }]);
  });

  it('field가 없는 내 기록은 분야 계산에서 빼고 본 전시로만 쓴다', () => {
    const cs = [cand('x', 1, { field: '사진' }), cand('y', 2, { field: '사진' })];
    const out = recommendPersonal(cs, {
      ...base,
      myRecords: [my('x', 5, null), my('m', 5)],
      interests: ['사진'],
      limit: 1,
    });
    expect(out.items).toEqual([{ id: 'y', reason: '관심 분야 사진', source: 'personal' }]);
  });

  it('모자라면 인기 전시로 채우고 filledWithPopular', () => {
    const cs = [
      cand('m', 500, { field: '회화' }),
      cand('p', 100, { field: '사진', venueId: 'venue-a' }),
      cand('q', 50, { field: '조각' }),
      cand('seen', 1, { field: '조각' }),
    ];
    const out = recommendPersonal(cs, {
      ...base,
      ratingOf: ratingFrom({ q: rated(4.8, 9) }),
      popularVenueIds: ['venue-a'],
      myRecords: [my('seen', 5, '회화')],
      interests: [],
      limit: 3,
    });
    expect(out.items).toEqual([
      { id: 'm', reason: '내가 높게 평가한 회화 분야', source: 'personal' },
      { id: 'q', reason: '근처 인기 전시', source: 'popular' },
      { id: 'p', reason: '근처 인기 전시', source: 'popular' },
    ]);
    expect(out.filledWithPopular).toBe(true);
  });

  it('분야가 없는 후보는 맞춤에서 빠지지만 인기 채우기에는 들어간다', () => {
    const cs = [cand('nofield', 1, { field: null }), cand('empty', 2, { field: '' }), cand('ok', 3, { field: '회화' })];
    const out = recommendPersonal(cs, { ...base, myRecords: [], interests: ['회화', ''], limit: 3 });
    expect(out.items).toEqual([
      { id: 'ok', reason: '관심 분야 회화', source: 'personal' },
      { id: 'nofield', reason: '근처 인기 전시', source: 'popular' },
      { id: 'empty', reason: '근처 인기 전시', source: 'popular' },
    ]);
    expect(out.filledWithPopular).toBe(true);
  });

  it('기록도 관심 분야도 없으면 전부 인기 전시', () => {
    const cs = [cand('a', 2, { field: '회화' }), cand('b', 1)];
    const out = recommendPersonal(cs, { ...base, myRecords: [], interests: [] });
    expect(ids(out.items)).toEqual(['b', 'a']);
    expect(out.items.every((i) => i.source === 'popular')).toBe(true);
    expect(out.filledWithPopular).toBe(true);
  });

  it('맞춤 정렬에서도 거리 null은 맨 뒤, limit 기본 5', () => {
    const cs = [
      cand('n', null, { field: '회화' }),
      ...Array.from({ length: 4 }, (_, i) => cand(`e${i}`, 10 - i, { field: '회화' })),
      cand('e9', 100, { field: '회화' }),
    ];
    const out = recommendPersonal(cs, { ...base, myRecords: [], interests: ['회화'] });
    expect(ids(out.items)).toEqual(['e3', 'e2', 'e1', 'e0', 'e9']);
    expect(out.filledWithPopular).toBe(false);
  });
});
