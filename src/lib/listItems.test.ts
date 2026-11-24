import { describe, expect, it } from 'vitest';
import { calculateDistance, type Coordinate } from '../engine/distance';
import { rankExhibitions } from '../engine/sort';
import type { Exhibition, JudgeResult, Venue } from '../types';
import { displayLocation, getCatalog, getHolidays, getVenues, judgeCatalog, todayInSeoul, type CatalogEntry, type JudgedEntry } from './catalog';
import { loadBundledExhibitions } from './manualExhibitions';
import type { VenueLinks } from '../engine/matchVenue';
import linksJson from '../../data/venue-links.json';
import type { AggregatedStat } from './ratings';
import type { TagStats } from './sharedRatings';
import {
  areaOf,
  buildListItems,
  DEFAULT_SORT,
  filterListItems,
  filterOptions,
  hasAnyDistance,
  sortListItems,
  SORT_OPTIONS,
  type ListItem,
} from './listItems';

const ORIGIN: Coordinate = { lat: 37.5759, lng: 126.9768 };

function venue(id: string, gu: Venue['gu'], lat = 37.57, lng = 126.98): Venue {
  return { id, name: `${id}관`, aliases: [], gu, type: '미술관', lat, lng, representative: true, source: 'test', verified: '2026-11-01' };
}

type Opt = { venue?: Venue | null; lat?: number; lng?: number; field?: string; placeName?: string };

function entry(id: string, title = `전시 ${id}`, o: Opt = {}): CatalogEntry {
  const exhibition: Exhibition = {
    id,
    venueId: '',
    title,
    start: '2026-11-01',
    end: '2026-12-31',
    field: o.field,
    placeName: o.placeName,
    lat: o.lat,
    lng: o.lng,
  };
  const v = o.venue ?? null;
  return {
    exhibition,
    venue: v,
    match: { venueId: v?.id ?? null, by: v ? 'alias' : null },
    resolved: {} as CatalogEntry['resolved'],
  };
}

const judge = (result: JudgeResult['result'], slackMinutes?: number): JudgeResult => ({ result, reasons: [], slackMinutes });

function judged(id: string, j: JudgeResult, o: Opt & { title?: string } = {}): JudgedEntry {
  return { entry: entry(id, o.title, o), result: j };
}

const ids = (list: readonly ListItem[]) => list.map((i) => i.id);

/** 테스트용 항목: build 뒤 정렬 기준 필드만 덮어쓴다 */
function item(id: string, j: JudgeResult, patch: Partial<ListItem> = {}): ListItem {
  return { ...buildListItems([judged(id, j)])[0], ...patch };
}

/** 기본순만으로 순서가 정해지는 항목들 (판정·여유 시간·거리·id가 섞여 있다) */
function mixed(): ListItem[] {
  return [
    item('e', judge('impossible')),
    item('b', judge('possible', 30), { distance: 500 }),
    item('d', judge('unknown')),
    item('a', judge('possible', 30), { distance: 200 }),
    item('c', judge('possible', 90)),
    item('f', judge('possible', 30)),
  ];
}
const MIXED_DEFAULT = ['c', 'a', 'b', 'f', 'd', 'e'];

const stat = (count: number, averageRating: number): AggregatedStat => ({ count, averageRating, medianMinutes: 60 });

// pages/Hannune.tsx GU 복사본 (비교 기준). 페이지 함수는 내보내지 않아 여기에 그대로 옮겨 둔다
function hannuneGU(e: CatalogEntry): string {
  const { exhibition, venue: v } = e;
  if (v?.gu) return v.gu;
  const text = `${exhibition.placeName ?? ''} ${exhibition.title}`;
  if (text.includes('종로')) return '종로구';
  if (text.includes('중구')) return '중구';
  return '';
}

describe('sortListItems: default', () => {
  it('rankExhibitions 결과와 같다', () => {
    const items = mixed();
    const expected = rankExhibitions(items.map((i) => ({ ...i, distance: i.distance ?? undefined }))).map((i) => i.id);
    expect(ids(sortListItems(items, 'default'))).toEqual(expected);
    expect(ids(sortListItems(items, 'default'))).toEqual(MIXED_DEFAULT);
    expect(DEFAULT_SORT).toBe('default');
  });

  it('입력 배열을 바꾸지 않고 새 배열을 돌려준다', () => {
    for (const key of ['default', 'popular', 'distance'] as const) {
      const items = mixed();
      const before = ids(items);
      const out = sortListItems(items, key);
      expect(out).not.toBe(items);
      expect(ids(items)).toEqual(before);
    }
  });

  it('같은 입력은 순서를 섞어 넣어도 같은 결과', () => {
    for (const key of ['default', 'popular', 'distance'] as const) {
      const a = sortListItems(mixed(), key);
      const b = sortListItems([...mixed()].reverse(), key);
      expect(ids(a)).toEqual(ids(b));
    }
  });
});

describe('sortListItems: popular', () => {
  it('평가 수 > 평균 > 태그 사용자 수 > 기본순', () => {
    const items = [
      item('tagsOnly', judge('possible', 90), { userTags: [{ tag: '조용함', users: 3 }] }),
      item('low', judge('impossible'), { ratingCount: 2, ratingAvg: 3.0 }),
      item('high', judge('impossible'), { ratingCount: 2, ratingAvg: 4.5 }),
      item('many', judge('unknown'), { ratingCount: 5, ratingAvg: 2.0 }),
      item('highTags', judge('impossible'), { ratingCount: 2, ratingAvg: 4.5, userTags: [{ tag: 'a', users: 2 }, { tag: 'b', users: 2 }] }),
      item('plain', judge('possible', 120)),
    ];
    expect(ids(sortListItems(items, 'popular'))).toEqual(['many', 'highTags', 'high', 'low', 'tagsOnly', 'plain']);
  });

  it('전부 동점이면 기본순과 완전히 같다', () => {
    expect(ids(sortListItems(mixed(), 'popular'))).toEqual(MIXED_DEFAULT);
  });

  it('평가 수·평균이 같고 태그도 같으면 기본순', () => {
    const items = mixed().map((i) => ({ ...i, ratingCount: 3, ratingAvg: 4, userTags: [{ tag: 'x', users: 2 }] }));
    expect(ids(sortListItems(items, 'popular'))).toEqual(MIXED_DEFAULT);
  });
});

describe('sortListItems: distance', () => {
  it('가까운 순, null은 맨 뒤, 같은 거리·null끼리는 기본순', () => {
    const items = [
      item('none1', judge('impossible')),
      item('far', judge('possible', 90), { distance: 900 }),
      item('none2', judge('possible', 10)),
      item('sameB', judge('unknown'), { distance: 300 }),
      item('sameA', judge('possible', 5), { distance: 300 }),
      item('near', judge('impossible'), { distance: 100 }),
    ];
    expect(ids(sortListItems(items, 'distance'))).toEqual(['near', 'sameA', 'sameB', 'far', 'none2', 'none1']);
  });

  it('거리가 모두 null이면 기본순', () => {
    const items = mixed().map((i) => ({ ...i, distance: null }));
    expect(ids(sortListItems(items, 'distance'))).toEqual(ids(sortListItems(items, 'default')));
  });

  it('hasAnyDistance', () => {
    expect(hasAnyDistance(mixed())).toBe(true);
    expect(hasAnyDistance(mixed().map((i) => ({ ...i, distance: null })))).toBe(false);
    expect(hasAnyDistance([])).toBe(false);
  });

  it('SORT_OPTIONS', () => {
    expect(SORT_OPTIONS).toEqual([
      { key: 'popular', label: '인기순' },
      { key: 'distance', label: '거리순' },
    ]);
  });
});

describe('buildListItems', () => {
  const V = venue('venue-x', '종로구', 37.58, 126.97);

  it('통계가 없으면 0 / null / []', () => {
    const [it1] = buildListItems([judged('x', judge('possible', 30), { venue: V })]);
    expect(it1.ratingCount).toBe(0);
    expect(it1.ratingAvg).toBeNull();
    expect(it1.userTags).toEqual([]);
    expect(it1.slackMinutes).toBe(30);
  });

  it('통계에 그 전시가 없으면 0 / null / [], 있으면 값을 붙인다', () => {
    const ratingStats = new Map([['x', stat(4, 4.25)]]);
    const tagStats: TagStats = new Map([['x', [{ tag: '조용함', users: 3 }]]]);
    const [x, y] = buildListItems([judged('x', judge('possible')), judged('y', judge('possible'))], { ratingStats, tagStats });
    expect([x.ratingCount, x.ratingAvg, x.userTags]).toEqual([4, 4.25, [{ tag: '조용함', users: 3 }]]);
    expect([y.ratingCount, y.ratingAvg, y.userTags]).toEqual([0, null, []]);
  });

  it('origin이 없으면 distance null', () => {
    const [a] = buildListItems([judged('a', judge('possible'), { venue: V })]);
    const [b] = buildListItems([judged('a', judge('possible'), { venue: V })], { origin: null });
    expect(a.distance).toBeNull();
    expect(b.distance).toBeNull();
  });

  it('전시 위치가 없으면(시설 없음·좌표 없음·0 좌표) distance null', () => {
    const list = buildListItems(
      [
        judged('none', judge('possible')),
        judged('nan', judge('possible'), { lat: Number.NaN, lng: Number.NaN }),
        judged('zero', judge('possible'), { lat: 0, lng: 0 }),
      ],
      { origin: ORIGIN },
    );
    expect(list.map((i) => i.distance)).toEqual([null, null, null]);
  });

  it('거리는 내 주변 계산(displayLocation + calculateDistance)과 같다', () => {
    const js = [judged('v', judge('possible'), { venue: V }), judged('own', judge('possible'), { venue: V, lat: 37.566, lng: 126.978 })];
    const list = buildListItems(js, { origin: ORIGIN });
    list.forEach((li, i) => {
      expect(li.distance).toBe(calculateDistance(ORIGIN, displayLocation(js[i].entry)!));
      expect(Number.isInteger(li.distance)).toBe(true);
    });
    // 전시 좌표가 시설 좌표보다 먼저
    expect(list[1].distance).not.toBe(list[0].distance);
  });

  it('입력을 바꾸지 않고, 기본 필드를 채운다', () => {
    const js = [judged('a', judge('unknown'), { venue: V, field: '전시/미술', title: '수묵화 특별전' })];
    const before = JSON.stringify(js);
    const [a] = buildListItems(js);
    expect(JSON.stringify(js)).toBe(before);
    expect(a.id).toBe('a');
    expect(a.entry).toBe(js[0].entry);
    expect(a.judge).toBe(js[0].result);
    expect(a.field).toBe('전시/미술');
    expect(a.topicTags).toContain('회화·수묵');
    expect([a.start, a.end]).toEqual(['2026-11-01', '2026-12-31']);
    expect(a.slackMinutes).toBeNull();
  });

  it('areaOf는 Hannune GU와 같은 결과 (GU의 \'\'는 \'기타\')', () => {
    const cases = [
      entry('1', '아무 전시', { venue: venue('v1', '중구') }),
      entry('2', '종로 이야기', { venue: venue('v2', '중구') }), // 시설 gu가 먼저
      entry('3', '특별전', { placeName: '종로구 세종문화회관' }),
      entry('4', '서울 중구 역사전', { placeName: '어느 갤러리' }),
      entry('5', '특별전', { placeName: '용산 전쟁기념관' }),
      entry('6', '특별전'),
    ];
    expect(cases.map(areaOf)).toEqual(['중구', '중구', '종로구', '중구', '기타', '기타']);
    for (const e of [...cases, ...getCatalog()]) {
      expect(areaOf(e)).toBe(hannuneGU(e) || '기타');
    }
  });
});

describe('filterListItems / filterOptions', () => {
  const V_JONGNO = venue('v-j', '종로구');
  const V_JUNG = venue('v-g', '중구');
  const list = buildListItems(
    [
      judged('a', judge('possible', 30), { venue: V_JONGNO, field: '전시/미술', title: '수묵화전' }),
      judged('b', judge('impossible'), { venue: V_JUNG, field: '전시/미술', title: '사진전' }),
      judged('c', judge('possible', 10), { field: '교육/체험', title: '체험 교실' }),
      judged('d', judge('unknown'), { venue: V_JONGNO, title: '무제' }),
    ],
    { tagStats: new Map([['b', [{ tag: '조용함', users: 2 }]], ['d', [{ tag: '조용함', users: 4 }]]]) },
  );

  it('빈 조건은 거르지 않는다', () => {
    expect(ids(filterListItems(list))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(filterListItems(list, { openNow: false, fields: [], areas: [], tag: '' }))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('각 조건 단독', () => {
    expect(ids(filterListItems(list, { openNow: true }))).toEqual(['a', 'c']);
    expect(ids(filterListItems(list, { fields: ['전시/미술'] }))).toEqual(['a', 'b']);
    expect(ids(filterListItems(list, { areas: ['종로구'] }))).toEqual(['a', 'd']);
    expect(ids(filterListItems(list, { areas: ['기타'] }))).toEqual(['c']);
    expect(ids(filterListItems(list, { tag: '조용함' }))).toEqual(['b', 'd']); // 사용자 태그
    expect(ids(filterListItems(list, { tag: '회화·수묵' }))).toEqual(['a']); // 주제 태그
  });

  it('조합', () => {
    expect(ids(filterListItems(list, { openNow: true, fields: ['전시/미술', '교육/체험'], areas: ['종로구', '기타'] }))).toEqual(['a', 'c']);
    expect(ids(filterListItems(list, { tag: '조용함', areas: ['종로구'] }))).toEqual(['d']);
    expect(ids(filterListItems(list, { openNow: true, tag: '조용함' }))).toEqual([]);
  });

  it('순서를 바꾸지 않아 정렬과 필터의 순서를 바꿔도 결과가 같다', () => {
    const criteria = { areas: ['종로구', '기타'] };
    const reversed = [...list].reverse();
    expect(ids(filterListItems(reversed, criteria))).toEqual(['d', 'c', 'a']);
    for (const key of ['default', 'popular', 'distance'] as const) {
      expect(ids(sortListItems(filterListItems(list, criteria), key))).toEqual(ids(filterListItems(sortListItems(list, key), criteria)));
    }
  });

  it('filterOptions: 개수 많은 순, 같으면 이름 순', () => {
    const opts = filterOptions(list);
    expect(opts.fields).toEqual([
      { value: '전시/미술', count: 2 },
      { value: '교육/체험', count: 1 },
    ]);
    expect(opts.areas).toEqual([
      { value: '종로구', count: 2 },
      { value: '기타', count: 1 },
      { value: '중구', count: 1 },
    ]);
    expect(opts.tags[0]).toEqual({ value: '조용함', count: 2 });
    expect(opts.tags).toContainEqual({ value: '회화·수묵', count: 1 });
    expect(filterOptions([])).toEqual({ fields: [], areas: [], tags: [] });
  });
});

describe('실제 데이터 (auto.json + manual.json)', () => {
  it('세 정렬 모두 항목을 잃지 않는다', () => {
    const js = judgeCatalog(getCatalog(), { date: '2026-11-23', stayStart: '14:00', stayEnd: '16:00' }, getHolidays());
    const items = buildListItems(js, { origin: ORIGIN });
    // manual.json은 끝난 전시를 빼므로 건수가 날짜에 따라 달라진다 → 고정 숫자 대신 번들 전시 수와 비교
    const total = loadBundledExhibitions(todayInSeoul(), getVenues(), linksJson as VenueLinks).length;
    expect(items).toHaveLength(total);
    expect(hasAnyDistance(items)).toBe(true);
    const all = [...ids(items)].sort();
    for (const key of ['default', 'popular', 'distance'] as const) {
      const out = sortListItems(items, key);
      expect(out).toHaveLength(total);
      expect([...ids(out)].sort()).toEqual(all);
    }
    // 공유 통계가 없으면 인기순 = 기본순
    expect(ids(sortListItems(items, 'popular'))).toEqual(ids(sortListItems(items, 'default')));
  });
});
