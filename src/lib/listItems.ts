/**
 * 한눈에·내 주변 목록이 같이 쓰는 목록 항목, 정렬(기본·인기·거리), 필터 (교수님 피드백 6번). 순수 함수만 둔다.
 * 사용법: const items = buildListItems(judged, { origin, ratingStats, tagStats })
 *         const shown = sortListItems(filterListItems(items, criteria), sortKey)
 * 통계는 sharedRatings의 useSyncExternalStore(subscribeStats, getCachedStats)로 읽은 값 s를
 *   { ratingStats: s.exhibitions, tagStats: s.tags }로 넘긴다(처음 한 번 fetchStats() 호출). 없으면 생략해도 된다.
 */
import { calculateDistance, type Coordinate } from '../engine/distance';
import { rankExhibitions } from '../engine/sort';
import type { JudgeResult } from '../types';
import { displayLocation, type CatalogEntry, type JudgedEntry } from './catalog';
import type { AggregatedStat } from './ratings';
import type { TagStats } from './sharedRatings';
import { tagsOf } from './tags';
import type { UserTagStat } from './userTags';

export type Area = '종로구' | '중구' | '기타';

export interface ListItem {
  /** 전시 id (exhibition.id) */
  id: string;
  entry: CatalogEntry;
  judge: JudgeResult;
  /** judge.slackMinutes를 꺼내 둔 값. 정렬은 judge.slackMinutes를 쓴다(rankExhibitions와 같게) */
  slackMinutes: number | null;
  /** 기준 위치에서 m(반올림 정수, 내 주변과 같은 값). 기준 위치나 전시 위치가 없으면 null */
  distance: number | null;
  /** 공유 별점 평가 수. 통계가 없으면 0 */
  ratingCount: number;
  /** 공유 별점 평균(반올림 전 값). 통계가 없으면 null */
  ratingAvg: number | null;
  /** 2명 이상이 단 사용자 태그 (users 많은 순) */
  userTags: { tag: string; users: number }[];
  /** #71 주제 태그 (tagsOf) */
  topicTags: string[];
  /** 서울시 API 분류(전시/미술, 교육/체험 …). 없으면 null */
  field: string | null;
  area: Area;
  start: string;
  end: string;
}

export interface ListItemContext {
  origin?: Coordinate | null;
  /** 전시 id → 별점 통계 (getCachedStats().exhibitions) */
  ratingStats?: ReadonlyMap<string, AggregatedStat> | null;
  /** 전시 id → 사용자 태그 통계 (getCachedStats().tags) */
  tagStats?: TagStats | null;
}

export type SortKey = 'default' | 'popular' | 'distance';

/** 화면 정렬 칩. 추천순은 기준이 정해지면 추가한다 */
export const SORT_OPTIONS: readonly { key: Exclude<SortKey, 'default'>; label: string }[] = [
  { key: 'popular', label: '인기순' },
  { key: 'distance', label: '거리순' },
];
export const DEFAULT_SORT: SortKey = 'default';

export interface FilterCriteria {
  /** true면 판정 possible만 */
  openNow?: boolean;
  fields?: readonly string[];
  areas?: readonly string[];
  /** 사용자 태그 또는 주제 태그 중 하나라도 같으면 남긴다 */
  tag?: string;
}

export interface OptionCount {
  value: string;
  count: number;
}

export interface FilterOptions {
  fields: OptionCount[];
  areas: OptionCount[];
  tags: OptionCount[];
}

// ─── 항목 만들기 ────────────────────────────────────────────

/**
 * 지역. pages/Hannune.tsx의 GU와 같은 규칙(시설 gu → 장소·제목에 '종로'/'중구')이고, GU가 ''를 내는 곳만 '기타'다.
 * 같은 규칙이 Hannune GU에도 있으니 한쪽을 바꾸면 다른 쪽도 바꾼다(페이지가 이 함수를 쓰게 되면 하나로 합친다).
 */
export function areaOf(entry: Pick<CatalogEntry, 'exhibition' | 'venue'>): Area {
  const { exhibition, venue } = entry;
  if (venue?.gu) return venue.gu;
  const text = `${exhibition.placeName ?? ''} ${exhibition.title}`;
  if (text.includes('종로')) return '종로구';
  if (text.includes('중구')) return '중구';
  return '기타';
}

/** 내 주변(NearbyExhibitions)과 같은 거리: displayLocation, (0, 0) 좌표는 위치 없음으로 본다 */
function distanceOf(entry: CatalogEntry, origin: Coordinate | null | undefined): number | null {
  if (!origin) return null;
  const loc = displayLocation(entry);
  if (!loc || loc.lat === 0 || loc.lng === 0) return null;
  return calculateDistance(origin, loc);
}

/** 판정 결과에 거리·공유 통계·태그·지역을 붙인다. 입력은 바꾸지 않고, 캐시·네트워크를 읽지 않는다 */
export function buildListItems(judged: readonly JudgedEntry[], ctx: ListItemContext = {}): ListItem[] {
  return judged.map(({ entry, result }) => {
    const { exhibition } = entry;
    const rating = ctx.ratingStats?.get(exhibition.id);
    const tags = ctx.tagStats?.get(exhibition.id) ?? [];
    return {
      id: exhibition.id,
      entry,
      judge: result,
      slackMinutes: typeof result.slackMinutes === 'number' ? result.slackMinutes : null,
      distance: distanceOf(entry, ctx.origin),
      ratingCount: rating?.count ?? 0,
      ratingAvg: rating ? rating.averageRating : null,
      userTags: tags.map(({ tag, users }: UserTagStat) => ({ tag, users })),
      topicTags: [...tagsOf(entry)],
      field: exhibition.field || null,
      area: areaOf(entry),
      start: exhibition.start,
      end: exhibition.end,
    };
  });
}

// ─── 정렬 ────────────────────────────────────────────────

/**
 * 기본순에서 각 항목의 위치. rankExhibitions를 그대로 쓴다.
 * (Rankable의 distance는 number | undefined라 null을 undefined로 바꿔 넘긴다. 순서 규칙은 같다)
 */
function defaultPositions(items: readonly ListItem[]): Map<ListItem, number> {
  const ranked = rankExhibitions(
    items.map((item) => ({ id: item.id, judge: item.judge, distance: item.distance ?? undefined, item })),
  );
  return new Map(ranked.map(({ item }, i) => [item, i]));
}

const tagUsersOf = (item: ListItem): number => item.userTags.reduce((sum, t) => sum + t.users, 0);

/** 값이 없는 쪽을 뒤로. 둘 다 있으면 null */
function missingLast(a: number | null, b: number | null): number | null {
  if (a !== null && b !== null) return null;
  if (a !== null) return -1;
  if (b !== null) return 1;
  return 0;
}

/**
 * 정렬한 새 배열을 돌려준다. 입력은 바꾸지 않는다.
 * - default: rankExhibitions (판정 → 여유 시간 → 거리 → id)
 * - popular: 평가 수 많은 순 → 평균 별점 높은 순(없으면 뒤) → 사용자 태그 사용자 수 합 큰 순 → 기본순
 * - distance: 거리 가까운 순(null은 뒤) → 기본순
 */
export function sortListItems(items: readonly ListItem[], key: SortKey = DEFAULT_SORT): ListItem[] {
  const pos = defaultPositions(items);
  const byDefault = (a: ListItem, b: ListItem) => pos.get(a)! - pos.get(b)!;

  if (key === 'popular') {
    return [...items].sort((a, b) => {
      if (a.ratingCount !== b.ratingCount) return b.ratingCount - a.ratingCount;
      const avgMissing = missingLast(a.ratingAvg, b.ratingAvg);
      if (avgMissing === null) {
        if (a.ratingAvg !== b.ratingAvg) return b.ratingAvg! - a.ratingAvg!;
      } else if (avgMissing !== 0) {
        return avgMissing;
      }
      const ta = tagUsersOf(a);
      const tb = tagUsersOf(b);
      if (ta !== tb) return tb - ta;
      return byDefault(a, b);
    });
  }

  if (key === 'distance') {
    return [...items].sort((a, b) => {
      const distMissing = missingLast(a.distance, b.distance);
      if (distMissing === null) {
        if (a.distance !== b.distance) return a.distance! - b.distance!;
      } else if (distMissing !== 0) {
        return distMissing;
      }
      return byDefault(a, b);
    });
  }

  return [...items].sort(byDefault);
}

/** 거리가 하나라도 있는지. 없으면 화면이 거리순 버튼을 막는다(한눈에는 위치를 받지 않는다) */
export function hasAnyDistance(items: readonly ListItem[]): boolean {
  return items.some((item) => item.distance !== null);
}

// ─── 필터 ────────────────────────────────────────────────

const active = (list: readonly string[] | undefined): list is readonly string[] => !!list && list.length > 0;

/** 조건에 맞는 항목만 남긴다. 순서는 그대로. 빈 배열·undefined·빈 문자열 조건은 거르지 않는다 */
export function filterListItems(items: readonly ListItem[], criteria: FilterCriteria = {}): ListItem[] {
  const { openNow, fields, areas, tag } = criteria;
  return items.filter((item) => {
    if (openNow && item.judge.result !== 'possible') return false;
    if (active(fields) && (item.field === null || !fields.includes(item.field))) return false;
    if (active(areas) && !areas.includes(item.area)) return false;
    if (tag && !item.userTags.some((t) => t.tag === tag) && !item.topicTags.includes(tag)) return false;
    return true;
  });
}

function countValues(lists: Iterable<Iterable<string>>): OptionCount[] {
  const counts = new Map<string, number>();
  for (const list of lists) {
    for (const value of new Set(list)) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
}

/** 칩 목록과 개수. 개수 많은 순, 같으면 이름 순. 태그는 사용자 태그와 주제 태그를 합쳐 항목 수를 센다 */
export function filterOptions(items: readonly ListItem[]): FilterOptions {
  return {
    fields: countValues(items.map((item) => (item.field === null ? [] : [item.field]))),
    areas: countValues(items.map((item) => [item.area])),
    tags: countValues(items.map((item) => [...item.userTags.map((t) => t.tag), ...item.topicTags])),
  };
}
