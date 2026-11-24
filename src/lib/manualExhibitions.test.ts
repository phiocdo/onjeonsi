import { describe, expect, it } from 'vitest';
import type { Exhibition, Venue } from '../types';
import type { VenueLinks } from '../engine/matchVenue';
import autoJson from '../../data/exhibitions/auto.json';
import manualJson from '../../data/exhibitions/manual.json';
import linksJson from '../../data/venue-links.json';
import { buildCatalog, getVenues } from './catalog';
import { loadBundledExhibitions, normalizeTitle, sameExhibition, withManualExhibitions } from './manualExhibitions';

// ─── fixture ─────────────────────────────────────────────

const VENUE: Venue = {
  id: 'venue-a',
  name: '가나다미술관',
  aliases: ['가나다'],
  gu: '종로구',
  type: '미술관',
  lat: 37.57,
  lng: 126.97,
  representative: true,
  hours: { mon: { open: '10:00', close: '18:00' } },
  source: 'test',
  verified: '2026-11-01',
};
const VENUES = [VENUE];
const NO_LINKS: VenueLinks = {};

function exhibition(id: string, start: string, end: string, extra: Partial<Exhibition> = {}): Exhibition {
  return { id, venueId: '', title: id, start, end, ...extra };
}

const AUTO = [exhibition('auto-seoul-1', '2026-11-01', '2026-12-31')];
const TODAY = '2026-11-24';

function merge(auto: readonly Exhibition[], manual: readonly Exhibition[], today = TODAY): string[] {
  return withManualExhibitions(auto, manual, today, VENUES, NO_LINKS).map((e) => e.id);
}

// ─── 순수 함수 ────────────────────────────────────────────

describe('withManualExhibitions', () => {
  it('자동 수집 전시 뒤에 사람이 채운 전시를 붙인다', () => {
    expect(merge(AUTO, [exhibition('manual-a', '2026-11-01', '2026-12-31')])).toEqual(['auto-seoul-1', 'manual-a']);
  });

  it('끝난 전시는 빼고, 오늘 끝나는 전시는 남긴다', () => {
    const manual = [
      exhibition('manual-ended', '2026-10-01', '2026-11-23'),
      exhibition('manual-last-day', '2026-10-01', '2026-11-24'),
      exhibition('manual-upcoming', '2026-12-01', '2027-01-31'),
    ];
    expect(merge([], manual)).toEqual(['manual-last-day', 'manual-upcoming']);
  });

  it('id가 자동 수집 전시와 겹치면 사람이 채운 쪽을 버린다', () => {
    const manual = [exhibition('auto-seoul-1', '2026-11-01', '2026-12-31', { title: '덮어쓰기 시도' })];
    const merged = withManualExhibitions(AUTO, manual, TODAY, VENUES, NO_LINKS);
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('auto-seoul-1');
  });

  it('같은 전시가 자동 수집에도 있으면 자동 수집 쪽을 남긴다', () => {
    const auto = [exhibition('auto-seoul-9', '2026-11-01', '2027-01-31', { title: '《서도호》', placeName: '가나다미술관 2층' })];
    const manual = [exhibition('manual-kcisa-1', '2026-10-01', '2027-02-09', { title: '서도호', placeName: '가나다미술관' })];
    expect(merge(auto, manual)).toEqual(['auto-seoul-9']);
  });

  it('입력 배열을 바꾸지 않는다', () => {
    const manual = [exhibition('manual-a', '2026-11-01', '2026-12-31')];
    merge(AUTO, manual);
    expect(AUTO).toHaveLength(1);
    expect(manual).toHaveLength(1);
  });
});

describe('normalizeTitle', () => {
  it('[주최 표기]·기호·공백을 지우고 대소문자를 무시한다', () => {
    expect(normalizeTitle('[국립현대미술관] 《서도호》')).toBe('서도호');
    expect(normalizeTitle('MMCA×LG OLED 시리즈 2026')).toBe('mmcalgoled시리즈2026');
    expect(normalizeTitle('읽기의 기술: 종이에서 픽셀로')).toBe('읽기의기술종이에서픽셀로');
  });

  it('기호만 있는 제목은 빈 문자열', () => {
    expect(normalizeTitle('[안내] ※')).toBe('');
  });
});

describe('sameExhibition', () => {
  const venueIdOf = (e: Exhibition) => (e.placeName?.includes('가나다') ? 'venue-a' : null);
  const base = exhibition('a', '2026-11-01', '2026-12-31', { title: '서도호', placeName: '가나다미술관' });

  it('제목·기간·시설이 맞으면 같은 전시', () => {
    expect(sameExhibition(base, { ...base, id: 'b', title: '《서도호》' }, venueIdOf)).toBe(true);
  });

  it('제목이 다르면 다른 전시', () => {
    expect(sameExhibition(base, { ...base, id: 'b', title: '서도호의 현장들' }, venueIdOf)).toBe(false);
  });

  it('기간이 겹치지 않으면 다른 전시 (끝나는 날과 시작하는 날이 같으면 겹친다)', () => {
    expect(sameExhibition(base, { ...base, id: 'b', start: '2027-01-01', end: '2027-02-01' }, venueIdOf)).toBe(false);
    expect(sameExhibition(base, { ...base, id: 'b', start: '2026-12-31', end: '2027-02-01' }, venueIdOf)).toBe(true);
  });

  it('다른 시설이거나 한쪽만 시설에 연결되면 다른 전시', () => {
    const elsewhere = { ...base, id: 'b', placeName: '다른미술관' };
    expect(sameExhibition(base, elsewhere, venueIdOf)).toBe(false);
  });

  it('둘 다 시설에 연결되지 않으면 정규화한 장소 이름으로 본다', () => {
    const none = () => null;
    const a = { ...base, placeName: '라마바 갤러리 (2층)' };
    expect(sameExhibition(a, { ...a, id: 'b', placeName: '라마바갤러리' }, none)).toBe(true);
    expect(sameExhibition(a, { ...a, id: 'b', placeName: '사아자 갤러리' }, none)).toBe(false);
    expect(sameExhibition({ ...a, placeName: '' }, { ...a, id: 'b', placeName: '' }, none)).toBe(false);
  });
});

// ─── 실제 데이터 ──────────────────────────────────────────

describe('실제 데이터 (manual.json)', () => {
  const links = linksJson as VenueLinks;
  const bundled = loadBundledExhibitions(TODAY, getVenues(), links).map((e) => e.id);

  it('번들 전시는 자동 수집 전시를 모두 같은 순서로 앞에 둔다', () => {
    // catalog.test·listItems.test는 건수를 loadBundledExhibitions로 구하므로, 자동 수집 전시가 빠지는 회귀는 여기서 잡는다
    expect(bundled.slice(0, autoJson.length)).toEqual(autoJson.map((e) => e.id));
  });

  it('번들 전시에 끝나지 않은 manual 전시가 들어간다 (자동 수집과 겹치는 전시 없음)', () => {
    // 2026-11-24 기준 manual.json 5건 모두 진행 중이거나 예정이고, auto.json에 국립현대미술관 전시는 없다
    for (const item of manualJson) expect(bundled).toContain(item.id);
  });

  const catalog = buildCatalog(manualJson as unknown as Exhibition[], getVenues(), links, {
    useExhibitionHours: true,
  });

  it('직접 쓴 운영시간(scheduled)은 판정 근거로 쓰인다', () => {
    // 'venue'나 null이면 엔진이 손으로 쓴 요일 일정을 믿지 못한 것이다(구간이 비었거나 open >= close 등)
    for (const entry of catalog.filter((e) => e.exhibition.operatingHours?.scheduleType === 'scheduled')) {
      expect({ id: entry.exhibition.id, basis: entry.resolved.basis }).toEqual({
        id: entry.exhibition.id,
        basis: entry.venue ? 'merged' : 'exhibition',
      });
    }
  });

  it('운영시간을 시설 파일에 맡긴 전시(scheduleType unknown)는 시설에 연결된다', () => {
    // 연결이 안 되면 판정이 늘 "확인 필요: 시설 정보가 없습니다"가 된다
    for (const entry of catalog.filter((e) => e.exhibition.operatingHours?.scheduleType === 'unknown')) {
      expect({ id: entry.exhibition.id, venue: entry.venue?.id ?? null }).toEqual({
        id: entry.exhibition.id,
        venue: expect.any(String),
      });
    }
  });
});
