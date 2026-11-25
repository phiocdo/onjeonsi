import { describe, it, expect } from 'vitest';
import {
  personalBasis,
  recommendPersonal,
  recommendPopular,
  snapshotTags,
  type Candidate,
  type MyRecord,
} from './recommend';
import type { RatingSummary } from './ratings';

const cand = (
  id: string,
  distanceM: number | null,
  extra: Partial<Candidate> = {},
): Candidate => ({ id, venueId: null, tags: [], distanceM, result: 'possible', ...extra });

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
  label: `이 전시 기록 ${count}건`,
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
    expect(out[0]).toEqual({ id: 'b', reason: '별점 4.5 (이 전시 기록 3건)', source: 'popular' });
    expect(out[1].reason).toBe('별점 4.0 (이 전시 기록 10건)');
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

const my = (exhibitionId: string, rating: number, tags?: string[]): MyRecord => ({
  exhibitionId,
  venueId: null,
  rating,
  visitMinutes: 60,
  tags,
});

describe('personalBasis', () => {
  it('★4 이상 기록 태그의 합집합, TAGS 순서', () => {
    expect(personalBasis([my('a', 4, ['공예']), my('b', 5, ['회화·수묵', '공예']), my('c', 3, ['현대미술'])], ['사진·미디어'])).toEqual({
      tags: ['회화·수묵', '공예'],
      fromLiked: true,
    });
  });

  it('★4 이상 기록에 태그가 없으면 관심 주제, TAGS에 없는 값은 무시', () => {
    expect(personalBasis([my('a', 5, []), my('b', 5)], ['전시/미술', '공예', '', '회화·수묵'])).toEqual({
      tags: ['회화·수묵', '공예'],
      fromLiked: false,
    });
  });
});

describe('snapshotTags', () => {
  it('제목·장소 이름·시설 id로 tagsOf와 같은 규칙을 쓴다', () => {
    // 시설 기본 태그(VENUE_TAGS) + 제목 키워드, 앞 대괄호 표기는 뺀다
    expect(snapshotTags({ title: '[서울공예박물관] 사진 아카이브', venueName: '서울공예박물관', venueId: 'venue-craft-museum' })).toEqual([
      '공예',
      '사진·미디어',
    ]);
    // 시설이 없으면 장소 이름의 키워드
    expect(snapshotTags({ title: '무제', venueName: 'DDP 뮤지엄', venueId: null })).toEqual(['디자인·캐릭터']);
    expect(snapshotTags({ title: '무제', venueName: null, venueId: null })).toEqual([]);
  });
});

describe('recommendPersonal', () => {
  const base = { ratingOf: () => NONE, popularVenueIds: [] as string[], seenIds: [] as string[] };

  it('★4 이상 기록의 태그와 겹치는 수가 많은 순 → 가까운 순, 겹침 0은 뺀다', () => {
    const cs = [
      cand('one-far', 300, { tags: ['회화·수묵'] }),
      cand('two', 900, { tags: ['회화·수묵', '공예'] }),
      cand('one-near', 100, { tags: ['공예', '현대미술'] }),
      cand('zero', 10, { tags: ['사진·미디어'] }),
      cand('none', 5),
    ];
    const out = recommendPersonal(cs, {
      ...base,
      myRecords: [my('m1', 5, ['회화·수묵']), my('m2', 4, ['공예']), my('m3', 3, ['사진·미디어'])],
      interests: ['사진·미디어'],
      limit: 3,
    });
    expect(out.items).toEqual([
      { id: 'two', reason: '내가 높게 평가한 전시와 같은 주제: 회화·수묵, 공예', source: 'personal' },
      { id: 'one-near', reason: '내가 높게 평가한 전시와 같은 주제: 공예', source: 'personal' },
      { id: 'one-far', reason: '내가 높게 평가한 전시와 같은 주제: 회화·수묵', source: 'personal' },
    ]);
    expect(out.filledWithPopular).toBe(false);
  });

  it('reason의 겹친 태그는 TAGS 순서로 최대 2개', () => {
    const cs = [cand('a', 1, { tags: ['민속·소리', '공예', '회화·수묵'] })];
    const out = recommendPersonal(cs, {
      ...base,
      myRecords: [],
      interests: ['민속·소리', '공예', '회화·수묵'],
      limit: 1,
    });
    expect(out.items[0].reason).toBe('관심 주제: 회화·수묵, 공예');
  });

  it('본 전시(seenIds와 myRecords)는 뺀다', () => {
    const t = { tags: ['회화·수묵'] };
    const cs = [cand('a', 1, t), cand('b', 2, t), cand('c', 3, t)];
    const out = recommendPersonal(cs, {
      ...base,
      myRecords: [my('a', 5, ['회화·수묵'])],
      seenIds: ['b'],
      interests: [],
      limit: 1,
    });
    expect(ids(out.items)).toEqual(['c']);
  });

  it('possible만 고른다', () => {
    const cs = [cand('a', 1, { tags: ['공예'], result: 'unknown' }), cand('b', 2, { tags: ['공예'] })];
    const out = recommendPersonal(cs, { ...base, myRecords: [], interests: ['공예'], limit: 1 });
    expect(ids(out.items)).toEqual(['b']);
  });

  it('★4 이상 기록이 없으면 관심 주제', () => {
    const cs = [cand('a', 1, { tags: ['공예'] }), cand('b', 2, { tags: ['회화·수묵'] })];
    const out = recommendPersonal(cs, {
      ...base,
      myRecords: [my('m1', 3, ['회화·수묵'])],
      interests: ['공예'],
      limit: 1,
    });
    expect(out.items).toEqual([{ id: 'a', reason: '관심 주제: 공예', source: 'personal' }]);
  });

  it('태그가 없는 내 기록은 기준 계산에서 빠지고 본 전시로만 쓴다', () => {
    const cs = [cand('x', 1, { tags: ['공예'] }), cand('y', 2, { tags: ['공예'] })];
    const out = recommendPersonal(cs, {
      ...base,
      myRecords: [my('x', 5, []), my('m', 5)],
      interests: ['공예'],
      limit: 1,
    });
    expect(out.items).toEqual([{ id: 'y', reason: '관심 주제: 공예', source: 'personal' }]);
  });

  it('TAGS에 없는 예전 interests 값(분야 이름)은 무시한다', () => {
    const cs = [cand('a', 1, { tags: ['현대미술'] }), cand('b', 2, { tags: ['공예'] })];
    const onlyOld = recommendPersonal(cs, { ...base, myRecords: [], interests: ['전시/미술'], limit: 2 });
    expect(onlyOld.items.every((i) => i.source === 'popular')).toBe(true);
    expect(onlyOld.filledWithPopular).toBe(true);

    const mixed = recommendPersonal(cs, { ...base, myRecords: [], interests: ['전시/미술', '공예'], limit: 1 });
    expect(mixed.items).toEqual([{ id: 'b', reason: '관심 주제: 공예', source: 'personal' }]);
  });

  it('모자라면 인기 전시로 채우고 filledWithPopular', () => {
    const cs = [
      cand('m', 500, { tags: ['회화·수묵'] }),
      cand('p', 100, { tags: ['사진·미디어'], venueId: 'venue-a' }),
      cand('q', 50, { tags: ['공예'] }),
      cand('seen', 1, { tags: ['회화·수묵'] }),
    ];
    const out = recommendPersonal(cs, {
      ...base,
      ratingOf: ratingFrom({ q: rated(4.8, 9) }),
      popularVenueIds: ['venue-a'],
      myRecords: [my('seen', 5, ['회화·수묵'])],
      interests: [],
      limit: 3,
    });
    expect(out.items).toEqual([
      { id: 'm', reason: '내가 높게 평가한 전시와 같은 주제: 회화·수묵', source: 'personal' },
      { id: 'q', reason: '별점 4.8 (이 전시 기록 9건)', source: 'popular' },
      { id: 'p', reason: '근처 인기 전시', source: 'popular' },
    ]);
    expect(out.filledWithPopular).toBe(true);
  });

  it('인기 전시로 채울 때 recommendPopular의 reason·source를 그대로 쓴다', () => {
    const cs = [
      cand('mine', 10, { tags: ['공예'] }),
      cand('star', 900, { tags: ['사진·미디어'] }),
      cand('plain', 20, { tags: ['현대미술'] }),
    ];
    const opts = {
      ...base,
      ratingOf: ratingFrom({ star: rated(4.2, 7) }),
      myRecords: [],
      interests: ['공예'],
      limit: 3,
    };
    const out = recommendPersonal(cs, opts);
    const popular = recommendPopular(cs, {
      ratingOf: opts.ratingOf,
      popularVenueIds: [],
      excludeIds: ['mine'],
      limit: 2,
    });
    expect(out.items.slice(1)).toEqual(popular);
    expect(out.items[1]).toEqual({ id: 'star', reason: '별점 4.2 (이 전시 기록 7건)', source: 'popular' });
    expect(out.items[2]).toEqual({ id: 'plain', reason: '근처 인기 전시', source: 'popular' });
  });

  it('태그가 없는 후보는 맞춤에서 빠지지만 인기 채우기에는 들어간다', () => {
    const cs = [cand('notag', 1), cand('other', 2, { tags: ['현대미술'] }), cand('ok', 3, { tags: ['공예'] })];
    const out = recommendPersonal(cs, { ...base, myRecords: [], interests: ['공예'], limit: 3 });
    expect(out.items).toEqual([
      { id: 'ok', reason: '관심 주제: 공예', source: 'personal' },
      { id: 'notag', reason: '근처 인기 전시', source: 'popular' },
      { id: 'other', reason: '근처 인기 전시', source: 'popular' },
    ]);
    expect(out.filledWithPopular).toBe(true);
  });

  it('기록도 관심 주제도 없으면 전부 인기 전시', () => {
    const cs = [cand('a', 2, { tags: ['공예'] }), cand('b', 1)];
    const out = recommendPersonal(cs, { ...base, myRecords: [], interests: [] });
    expect(ids(out.items)).toEqual(['b', 'a']);
    expect(out.items.every((i) => i.source === 'popular')).toBe(true);
    expect(out.filledWithPopular).toBe(true);
  });

  it('같은 겹침 수에서 거리 null은 맨 뒤, limit 기본 5', () => {
    const t = { tags: ['공예'] };
    const cs = [
      cand('n', null, t),
      ...Array.from({ length: 4 }, (_, i) => cand(`e${i}`, 10 - i, t)),
      cand('e9', 100, t),
    ];
    const out = recommendPersonal(cs, { ...base, myRecords: [], interests: ['공예'] });
    expect(ids(out.items)).toEqual(['e3', 'e2', 'e1', 'e0', 'e9']);
    expect(out.filledWithPopular).toBe(false);
  });
});
