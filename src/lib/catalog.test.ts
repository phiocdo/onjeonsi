import { describe, expect, it } from 'vitest';
import type { Exhibition, Venue } from '../types';
import { REASONS } from '../engine/reasons';
import exhibitionsJson from '../../data/exhibitions/auto.json';
import {
  basisLabel,
  buildCatalog,
  displayLocation,
  displayVenueName,
  getCatalog,
  judgeEntry,
  mismatchReport,
  todayInSeoul,
  type CatalogEntry,
} from './catalog';

// ─── fixture ─────────────────────────────────────────────

const VENUE_A: Venue = {
  id: 'venue-a',
  name: '가나다미술관',
  aliases: ['가나다'],
  gu: '종로구',
  type: '미술관',
  lat: 37.57,
  lng: 126.97,
  representative: true,
  hours: {
    tue: { open: '10:00', close: '18:00' },
    wed: { open: '10:00', close: '18:00' },
    thu: { open: '10:00', close: '18:00' },
    fri: { open: '10:00', close: '18:00' },
    sat: { open: '10:00', close: '18:00' },
    sun: { open: '10:00', close: '18:00' },
  },
  closed: { weekday: 'mon' },
  lastEntry: '17:00',
  visitMinutes: 60,
  source: 'test',
  verified: '2026-11-01',
};

const VENUE_B: Venue = {
  id: 'venue-b',
  name: '라마바박물관',
  aliases: [],
  gu: '중구',
  type: '박물관',
  lat: 37.56,
  lng: 126.98,
  representative: false,
  hours: { sat: { open: '09:00', close: '18:00' } },
  closed: { weekday: 'sun' },
  lastEntry: '17:00',
  visitMinutes: 60,
  source: 'test',
  verified: '2026-11-01',
};

function ex(id: string, overrides: Partial<Exhibition> = {}): Exhibition {
  return {
    id,
    venueId: '',
    title: `전시 ${id}`,
    start: '2026-11-01',
    end: '2026-11-30',
    ...overrides,
  };
}

const EX_ALIAS = ex('alias', { placeName: '가나다미술관 2층' });
const EX_NONE = ex('none', { placeName: '어딘가 갤러리', lat: 37.0, lng: 127.5 });
const EX_LINK = ex('link', { placeName: '라마바 별채 전시실' });
// alias로는 가나다미술관에 맞지만 links에서 null로 막은 장소
const EX_LINK_NULL = ex('link-null', { placeName: '가나다 카페' });

const LINKS = { '라마바 별채 전시실': 'venue-b', '가나다 카페': null };

const VENUES = [VENUE_A, VENUE_B];
const EXHIBITIONS = [EX_ALIAS, EX_NONE, EX_LINK, EX_LINK_NULL];

function build(): CatalogEntry[] {
  return buildCatalog(EXHIBITIONS, VENUES, LINKS);
}

// ─── tests ───────────────────────────────────────────────

describe('todayInSeoul', () => {
  it('서울 시간대 기준 날짜를 돌려준다', () => {
    expect(todayInSeoul(new Date('2026-11-15T20:00:00Z'))).toBe('2026-11-16');
    expect(todayInSeoul(new Date('2026-11-16T14:59:59Z'))).toBe('2026-11-16');
    expect(todayInSeoul(new Date('2026-11-16T15:00:00Z'))).toBe('2026-11-17');
  });
});

describe('buildCatalog', () => {
  it('alias로 연결하고 venue는 시설 원본 객체다', () => {
    const [entry] = build();
    expect(entry.match).toEqual({ venueId: 'venue-a', by: 'alias' });
    expect(entry.venue).toBe(VENUE_A);
    expect(entry.exhibition).toBe(EX_ALIAS);
    expect(entry.resolved.basis).toBe('venue');
  });

  it('연결되지 않으면 venue와 resolved.venue가 null이다', () => {
    const entry = build()[1];
    expect(entry.match).toEqual({ venueId: null, by: null });
    expect(entry.venue).toBeNull();
    expect(entry.resolved.venue).toBeNull();
  });

  it('links로 연결한다', () => {
    const entry = build()[2];
    expect(entry.match).toEqual({ venueId: 'venue-b', by: 'link' });
    expect(entry.venue).toBe(VENUE_B);
    expect(entry.resolved.basis).toBe('venue');
  });

  it('links 값이 null이면 alias가 맞아도 연결하지 않는다', () => {
    const entry = build()[3];
    expect(entry.match).toEqual({ venueId: null, by: 'link' });
    expect(entry.venue).toBeNull();
    expect(entry.resolved.venue).toBeNull();
  });

  it('입력 배열과 객체를 바꾸지 않는다', () => {
    const before = JSON.stringify({ EXHIBITIONS, VENUES, LINKS });
    const entries = build();
    // resolved.venue는 복사본이라 고쳐도 원본에 닿지 않는다
    entries[0].resolved.venue!.name = 'changed';
    expect(JSON.stringify({ EXHIBITIONS, VENUES, LINKS })).toBe(before);
    expect(EXHIBITIONS).toHaveLength(4);
  });
});

describe('judgeEntry', () => {
  const entries = build();

  it('시설 있음: 가능', () => {
    const r = judgeEntry(entries[0], { date: '2026-11-21', stayStart: '14:00', stayEnd: '17:00' }, []);
    expect(r.result).toBe('possible');
    expect(r.basis).toBe('venue');
  });

  it('시설 있음: 불가 (휴관일)', () => {
    const r = judgeEntry(entries[0], { date: '2026-11-23', stayStart: '14:00', stayEnd: '17:00' }, []);
    expect(r.result).toBe('impossible');
  });

  it('시설 없음: unknown + MISSING_VENUE', () => {
    const r = judgeEntry(entries[1], { date: '2026-11-21', stayStart: '14:00', stayEnd: '17:00' }, []);
    expect(r.result).toBe('unknown');
    expect(r.reasons).toContain(REASONS.MISSING_VENUE);
  });
});

describe('displayLocation', () => {
  it('전시 좌표가 있으면 전시 좌표', () => {
    const [entry] = buildCatalog([{ ...EX_ALIAS, lat: 37.5701, lng: 126.9701 }], VENUES);
    expect(displayLocation(entry)).toEqual({ lat: 37.5701, lng: 126.9701 });
  });

  it('전시 lat만 null이면 시설 좌표', () => {
    const exNullLat = { ...EX_ALIAS, lat: null, lng: 126.9701 } as unknown as Exhibition;
    const [entry] = buildCatalog([exNullLat], VENUES);
    expect(displayLocation(entry)).toEqual({ lat: VENUE_A.lat, lng: VENUE_A.lng });
  });

  it('둘 다 없으면 null', () => {
    const [entry] = buildCatalog([ex('x', { placeName: '없는 곳' })], VENUES);
    expect(displayLocation(entry)).toBeNull();
  });
});

describe('displayVenueName', () => {
  it('시설 이름 → placeName → 빈 문자열', () => {
    const entries = build();
    expect(displayVenueName(entries[0])).toBe('가나다미술관');
    expect(displayVenueName(entries[1])).toBe('어딘가 갤러리');
    expect(displayVenueName(buildCatalog([ex('y')], VENUES)[0])).toBe('');
  });
});

describe('basisLabel', () => {
  it('네 가지', () => {
    expect(basisLabel('venue')).toBe('시설 안내 기준');
    expect(basisLabel('exhibition')).toBe('전시 안내 기준');
    expect(basisLabel('merged')).toBe('시설·전시 안내 기준');
    expect(basisLabel(undefined)).toBeNull();
  });
});

describe('mismatchReport', () => {
  it('차이가 있는 전시만 돌려준다', () => {
    const day = { isOpen: true, intervals: [{ open: '10:00', close: '20:00' }] };
    const closedDay = { isOpen: false, intervals: [] };
    const withHours = ex('mm', {
      placeName: '가나다미술관',
      operatingHours: {
        scheduleType: 'scheduled',
        weekdays: {
          mon: closedDay, tue: closedDay, wed: closedDay, thu: closedDay, fri: closedDay,
          sat: day, sun: closedDay,
        },
        holiday: null,
        exceptions: [],
      },
    });
    const report = mismatchReport(buildCatalog([EX_ALIAS, withHours], VENUES));
    expect(report).toHaveLength(1);
    expect(report[0].exhibitionId).toBe('mm');
    expect(report[0].venueId).toBe('venue-a');
    expect(report[0].mismatches).toEqual([
      { weekday: 'sat', kind: 'close', venueValue: '18:00', exhibitionValue: '20:00' },
    ]);
  });
});

describe('getCatalog (실제 데이터)', () => {
  it('두 번 불러도 같은 배열', () => {
    expect(getCatalog()).toBe(getCatalog());
  });

  it('스모크: 오류 없이 전시 수만큼 항목을 만든다', () => {
    const catalog = getCatalog();
    expect(Array.isArray(catalog)).toBe(true);
    expect(catalog).toHaveLength(exhibitionsJson.length);
  });
});
