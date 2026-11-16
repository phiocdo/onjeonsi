import type { Venue } from '../types';
import { calculateDistance, type Coordinate } from './distance';

/** 전시 좌표와 시설 좌표가 이 거리(m) 이내여야 같은 곳으로 본다 */
export const VENUE_MATCH_RADIUS_M = 100;

export interface MatchVenueExhibition {
  placeName?: string;
  lat?: number | null;
  lng?: number | null;
}

export interface MatchVenueResult {
  venueId: string | null;
  by: 'link' | 'alias' | 'coord' | null;
}

/** data/venue-links.json 형식: placeName 원문 → venueId (null이면 "연결하지 않음"으로 확정) */
export type VenueLinks = Record<string, string | null>;

// 층·관 표기. 괄호는 먼저 따로 지운다.
const FLOOR_HALL_PATTERNS: RegExp[] = [
  /지하\s*\d+\s*층/g, // 지하1층
  /(?<![A-Za-z])B\s*\d+\s*층?/g, // B1, B2층
  /\d+\s*[층F](?![A-Za-z])/g, // 3층, 2F
  /제?\s*\d+\s*관/g, // 2관, 제1관
  /전시\s*\d+\s*동/g, // 전시1동
  /본관|별관|신관/g,
];

/** 괄호와 그 안의 내용, 층·관 표기를 지우고 공백을 모두 없앤다. */
export function normalizePlaceName(name: string): string {
  let s = name.replace(/\([^)]*\)|\[[^\]]*\]|（[^）]*）/g, '');
  for (const re of FLOOR_HALL_PATTERNS) s = s.replace(re, '');
  return s.replace(/\s+/g, '');
}

function toCoordinate(lat: unknown, lng: unknown): Coordinate | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // 0은 "값 없음"을 0으로 채운 경우로 본다 (서울 좌표에 0은 나올 수 없음)
  if (lat === 0 || lng === 0) return null;
  return { lat, lng };
}

function isNear(a: Coordinate, b: Coordinate): boolean {
  return calculateDistance(a, b) <= VENUE_MATCH_RADIUS_M;
}

/**
 * 전시의 장소명·좌표로 시설을 찾는다. 순수 함수 — 파일을 읽지 않는다.
 *
 * 1. links에 placeName 원문이 있으면 그 값 (by: 'link')
 * 2. 정규화한 placeName이 시설 name/alias를 포함하면, 가장 긴 이름이 맞은 시설 (by: 'alias')
 *    전시 좌표가 있으면 그 시설과 100m 이내일 때만 연결하고, 밖이면 연결하지 않는다.
 * 3. 이름이 맞는 시설이 없고 전시 좌표가 있으면, 100m 이내 시설이 정확히 하나일 때 (by: 'coord')
 */
export function matchVenue(
  exhibition: MatchVenueExhibition,
  venues: readonly Venue[],
  links: VenueLinks = {},
): MatchVenueResult {
  const placeName = exhibition.placeName ?? '';

  if (placeName && Object.hasOwn(links, placeName)) {
    return { venueId: links[placeName] ?? null, by: 'link' };
  }

  const exCoord = toCoordinate(exhibition.lat, exhibition.lng);
  const normalizedPlace = normalizePlaceName(placeName);

  let best: Venue | null = null;
  let bestLen = 0;
  if (normalizedPlace) {
    for (const venue of venues) {
      for (const name of [venue.name, ...(venue.aliases ?? [])]) {
        const n = normalizePlaceName(name);
        if (n && n.length > bestLen && normalizedPlace.includes(n)) {
          best = venue;
          bestLen = n.length;
        }
      }
    }
  }

  if (best) {
    const venueCoord = toCoordinate(best.lat, best.lng);
    // 둘 다 좌표가 있을 때만 거리로 거른다
    if (exCoord && venueCoord && !isNear(exCoord, venueCoord)) {
      return { venueId: null, by: null };
    }
    return { venueId: best.id, by: 'alias' };
  }

  if (exCoord) {
    const near = venues.filter((v) => {
      const c = toCoordinate(v.lat, v.lng);
      return c !== null && isNear(exCoord, c);
    });
    if (near.length === 1) return { venueId: near[0].id, by: 'coord' };
  }

  return { venueId: null, by: null };
}
