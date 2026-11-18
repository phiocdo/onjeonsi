/**
 * 전시 카탈로그: 전시를 시설에 연결하고, 판정 근거를 정하고, 판정하는 일을 한곳에 모은다.
 *
 * - 화면은 전시·시설·공휴일 데이터를 직접 읽지 말고 이 파일의 함수만 쓴다.
 *   (getCatalog, getVenues, getVenue, getHolidays, judgeEntry, judgeCatalog, displayLocation, displayVenueName, basisLabel, todayInSeoul)
 * - 화면 표시에는 entry.venue(시설 파일 원본)와 entry.exhibition을 쓴다.
 *   entry.resolved는 판정에만 쓴다. (basis가 'exhibition'이면 resolved.venue의 이름·좌표는 빈 값·NaN이다)
 * - 판정은 judgeEntry / judgeCatalog로 한다. { result: 'unknown', reasons: [] }를 화면에서 직접 만들지 않는다.
 */
import type { Exhibition, JudgeResult, Venue } from '../types';
import { matchVenue, type MatchVenueResult, type VenueLinks } from '../engine/matchVenue';
import {
  judgeResolved,
  resolveSchedule,
  type Mismatch,
  type ResolveOptions,
  type ResolveResult,
} from '../engine/resolveSchedule';
import exhibitionsJson from '../../data/exhibitions/auto.json';
import holidaysJson from '../../data/holidays/holidays.json';

export interface CatalogEntry {
  exhibition: Exhibition;
  /** 시설 파일 원본. 화면 표시용. 연결된 시설이 없으면 null */
  venue: Venue | null;
  match: MatchVenueResult;
  /** resolveSchedule 결과. 판정용이며 화면 표시에 쓰지 않는다 */
  resolved: ResolveResult;
}

export interface CatalogQuery {
  date: string;
  stayStart: string;
  stayEnd: string;
}

export interface JudgedEntry {
  entry: CatalogEntry;
  result: JudgeResult;
}

export interface MismatchReportRow {
  exhibitionId: string;
  venueId: string | null;
  mismatches: Mismatch[];
}

// ─── 순수 함수 ────────────────────────────────────────────

/** 서울 기준 오늘 날짜(YYYY-MM-DD). 브라우저 시간대와 무관하다. */
export function todayInSeoul(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** 전시마다 시설 연결과 판정 근거를 한 번만 계산한다. 입력은 바꾸지 않는다. */
export function buildCatalog(
  exhibitions: readonly Exhibition[],
  venues: readonly Venue[],
  links: VenueLinks = {},
  options: ResolveOptions = { useExhibitionHours: false },
): CatalogEntry[] {
  const byId = new Map<string, Venue>();
  for (const v of venues) byId.set(v.id, v);

  return exhibitions.map((exhibition) => {
    // links 값이 null이면 matchVenue가 { venueId: null, by: 'link' }를 돌려준다 → 연결하지 않음
    const match = matchVenue(exhibition, venues, links);
    const venue = match.venueId === null ? null : (byId.get(match.venueId) ?? null);
    const resolved = resolveSchedule(venue, exhibition.operatingHours, options);
    return { exhibition, venue, match, resolved };
  });
}

/** 카탈로그 항목 하나를 판정한다. 시설이 없으면 MISSING_VENUE 사유가 붙는다. */
export function judgeEntry(
  entry: CatalogEntry,
  query: CatalogQuery,
  holidays: string[],
): JudgeResult {
  return judgeResolved(
    {
      exhibition: entry.exhibition,
      date: query.date,
      stayStart: query.stayStart,
      stayEnd: query.stayEnd,
      holidays,
    },
    entry.resolved,
  );
}

export function judgeCatalog(
  entries: readonly CatalogEntry[],
  query: CatalogQuery,
  holidays: string[],
): JudgedEntry[] {
  return entries.map((entry) => ({ entry, result: judgeEntry(entry, query, holidays) }));
}

/** 판정 근거를 화면 문구로 바꾼다. */
export function basisLabel(basis: JudgeResult['basis'] | null | undefined): string | null {
  switch (basis) {
    case 'venue':
      return '시설 안내 기준';
    case 'exhibition':
      return '전시 안내 기준';
    case 'merged':
      return '시설·전시 안내 기준';
    default:
      return null;
  }
}

function finiteCoord(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * 지도에 찍을 좌표. 전시 좌표 → 연결된 시설(원본) 좌표 → null.
 * resolved.venue의 좌표는 쓰지 않는다(basis 'exhibition'이면 NaN).
 */
export function displayLocation(entry: CatalogEntry): { lat: number; lng: number } | null {
  const ex = finiteCoord(entry.exhibition.lat, entry.exhibition.lng);
  if (ex) return ex;
  if (entry.venue) return finiteCoord(entry.venue.lat, entry.venue.lng);
  return null;
}

/** 화면에 보일 장소 이름. 시설 원본 이름 → 전시 placeName → ''. */
export function displayVenueName(entry: CatalogEntry): string {
  return entry.venue?.name || entry.exhibition.placeName || '';
}

/** 개발 확인용: 시설 데이터와 전시 운영 시간이 다른 전시만 모은다. 화면에 띄우지 않는다. */
export function mismatchReport(entries: readonly CatalogEntry[]): MismatchReportRow[] {
  return entries
    .filter((e) => e.resolved.mismatches.length > 0)
    .map((e) => ({
      exhibitionId: e.exhibition.id,
      venueId: e.match.venueId,
      mismatches: e.resolved.mismatches,
    }));
}

// ─── 번들된 데이터 ────────────────────────────────────────

// 시설 파일이 늘어도 코드를 고치지 않도록 폴더 전체를 읽는다
const venueModules = import.meta.glob<Venue>('/data/venues/*.json', {
  eager: true,
  import: 'default',
});
// PR #33 머지 전에는 파일이 없다 → 빈 객체
const linkModules = import.meta.glob<VenueLinks>('/data/venue-links.json', {
  eager: true,
  import: 'default',
});

// auto.json에는 lat: null이 있어 Exhibition(lat?: number)과 정확히 맞지 않는다.
// 좌표는 displayLocation / matchVenue에서 Number.isFinite로 다시 검사한다.
const bundledExhibitions = exhibitionsJson as Exhibition[];
const bundledHolidays: string[] = holidaysJson;

let venuesCache: Venue[] | null = null;
let catalogCache: CatalogEntry[] | null = null;

export function getVenues(): Venue[] {
  if (venuesCache === null) {
    venuesCache = Object.keys(venueModules)
      .sort()
      .map((path) => venueModules[path]);
  }
  return venuesCache;
}

export function getVenue(id: string): Venue | undefined {
  return getVenues().find((v) => v.id === id);
}

export function getHolidays(): string[] {
  return bundledHolidays;
}

function getLinks(): VenueLinks {
  return linkModules['/data/venue-links.json'] ?? {};
}

/** 번들된 데이터로 만든 카탈로그. 처음 부를 때 한 번만 계산한다. */
export function getCatalog(): CatalogEntry[] {
  if (catalogCache === null) {
    catalogCache = buildCatalog(bundledExhibitions, getVenues(), getLinks());
  }
  return catalogCache;
}
