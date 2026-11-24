/**
 * 사람이 채우는 전시(data/exhibitions/manual.json)를 자동 수집 전시(auto.json)에 붙인다.
 *
 * - manual.json은 auto.json과 형식이 같다(schema/exhibitions.schema.json).
 * - 추가만 한다. 자동 수집 전시를 고치는 데는 쓰지 않는다.
 *   id는 'manual-'로 시작하고, 검사 스크립트(validate-data.ts)가 이를 확인한다.
 * - 같은 전시가 자동 수집에도 들어오면 자동 수집 쪽을 남기고 manual 쪽을 뺀다(sameExhibition).
 *   그때는 manual.json에서 그 전시를 지우면 된다.
 * - 끝난 전시는 뺀다. 자동 수집은 매일 끝난 전시를 빼지만 manual.json은 사람이 지울 때까지 남는다.
 * - 운영시간은 사람이 operatingHours에 직접 쓴다(해석기를 거치지 않는다). hoursText는 화면 표시용 원문이다.
 *   시설 파일에만 맡기려면 scheduleType을 'unknown'으로 둔다.
 */
import type { Exhibition, Venue } from '../types';
import { matchVenue, normalizePlaceName, type VenueLinks } from '../engine/matchVenue';
import autoJson from '../../data/exhibitions/auto.json';
import manualJson from '../../data/exhibitions/manual.json';

/** 같은 전시인지 볼 때 쓰는 제목. [주최 표기]를 지우고 글자·숫자만 남긴다(대소문자 무시) */
export function normalizeTitle(title: string): string {
  return title
    .replace(/\[[^\]]*\]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * 두 전시가 같은 전시인지 본다. 출처가 달라 id로는 알 수 없어서 내용으로 판단한다.
 * - 정규화한 제목이 같다
 * - 기간이 겹친다
 * - 장소가 같다: 둘 다 시설에 연결되면 같은 시설, 둘 다 연결되지 않으면 정규화한 장소 이름이 같음.
 *   한쪽만 연결되면 다른 전시로 본다(다른 전시를 숨기는 것보다 같은 전시가 두 번 보이는 편이 낫다)
 */
export function sameExhibition(
  a: Exhibition,
  b: Exhibition,
  venueIdOf: (exhibition: Exhibition) => string | null,
): boolean {
  const title = normalizeTitle(a.title);
  if (!title || title !== normalizeTitle(b.title)) return false;
  if (a.start > b.end || b.start > a.end) return false;

  const venueA = venueIdOf(a);
  const venueB = venueIdOf(b);
  if (venueA !== null || venueB !== null) return venueA === venueB;
  const place = normalizePlaceName(a.placeName ?? '');
  return place !== '' && place === normalizePlaceName(b.placeName ?? '');
}

/**
 * 자동 수집 전시 뒤에 사람이 채운 전시를 붙인다. 아래에 걸리는 manual 전시는 뺀다.
 * - today(YYYY-MM-DD)보다 먼저 끝났다
 * - id가 자동 수집 전시와 겹친다
 * - 자동 수집 전시 중 같은 전시가 있다(sameExhibition)
 * 시설 연결은 카탈로그와 같은 matchVenue(venues, links)로 본다.
 */
export function withManualExhibitions(
  auto: readonly Exhibition[],
  manual: readonly Exhibition[],
  today: string,
  venues: readonly Venue[],
  links: VenueLinks,
): Exhibition[] {
  const venueIdOf = (exhibition: Exhibition) => matchVenue(exhibition, venues, links).venueId;
  const autoIds = new Set(auto.map((exhibition) => exhibition.id));
  const added = manual.filter(
    (exhibition) =>
      exhibition.end >= today &&
      !autoIds.has(exhibition.id) &&
      !auto.some((other) => sameExhibition(other, exhibition, venueIdOf)),
  );
  return [...auto, ...added];
}

/**
 * 번들된 전시 전체(auto.json + manual.json).
 * auto.json에는 lat: null이 있어 Exhibition(lat?: number)과 정확히 맞지 않는다.
 * 좌표는 displayLocation / matchVenue에서 Number.isFinite로 다시 검사한다.
 */
export function loadBundledExhibitions(today: string, venues: readonly Venue[], links: VenueLinks): Exhibition[] {
  return withManualExhibitions(
    autoJson as unknown as Exhibition[],
    manualJson as unknown as Exhibition[],
    today,
    venues,
    links,
  );
}
