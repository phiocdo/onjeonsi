import { describe, it, expect } from 'vitest';
import type { Venue } from '../types';
import { isOpen } from './isOpen';
import { REASONS } from './reasons';

const DAILY = { open: '10:00', close: '18:00' };

function makeVenue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: 'test-001',
    name: '테스트 미술관',
    aliases: [],
    gu: '종로구',
    type: '미술관',
    lat: 37.57,
    lng: 126.98,
    representative: false,
    source: 'test',
    verified: '2026-11-01',
    hours: { mon: DAILY, tue: DAILY, wed: DAILY, thu: DAILY, fri: DAILY, sat: DAILY, sun: DAILY },
    ...overrides,
  };
}

// 2026-11-09 월, 2026-11-10 화, 2026-11-14 토
const MON = '2026-11-09';
const TUE = '2026-11-10';
const SAT = '2026-11-14';

describe('isOpen', () => {
  it('1. 평일(화) 정상 운영이면 open', () => {
    const venue = makeVenue({ closed: { weekday: 'mon' } });
    expect(isOpen(venue, TUE, [])).toEqual({
      status: 'open',
      open: '10:00',
      close: '18:00',
      lastEntry: undefined,
    });
  });

  it('2. 휴관 요일(월)이면 closed', () => {
    const venue = makeVenue({ closed: { weekday: 'mon' } });
    expect(isOpen(venue, MON, [])).toEqual({
      status: 'closed',
      reason: REASONS.CLOSED_WEEKDAY('월'),
    });
  });

  it('3. 휴관 요일(월)이 공휴일이고 ifHoliday가 nextDay면 open', () => {
    const venue = makeVenue({ closed: { weekday: 'mon', ifHoliday: 'nextDay' } });
    expect(isOpen(venue, MON, [MON]).status).toBe('open');
  });

  it('4. 공휴일인 휴관 요일(월)의 다음 날(화)은 closed', () => {
    const venue = makeVenue({ closed: { weekday: 'mon', ifHoliday: 'nextDay' } });
    expect(isOpen(venue, TUE, [MON])).toEqual({
      status: 'closed',
      reason: REASONS.CLOSED_HOLIDAY,
    });
  });

  it("5. closed.dates의 'MM-DD' 고정 휴관일이면 closed", () => {
    const venue = makeVenue({ closed: { dates: ['01-01'] } });
    expect(isOpen(venue, '2027-01-01', [])).toEqual({
      status: 'closed',
      reason: REASONS.CLOSED_DATE,
    });
  });

  it("6. closed.dates의 'YYYY-MM-DD' 임시 휴관일이면 closed", () => {
    const venue = makeVenue({ closed: { dates: [SAT] } });
    expect(isOpen(venue, SAT, [])).toEqual({
      status: 'closed',
      reason: REASONS.CLOSED_DATE,
    });
  });

  it('7. 그 요일 hours가 없으면 unknown', () => {
    const venue = makeVenue({ hours: { mon: DAILY, tue: DAILY } });
    expect(isOpen(venue, SAT, [])).toEqual({
      status: 'unknown',
      reason: REASONS.MISSING_HOURS,
    });
    // hours 자체가 없어도 터지지 않는다
    expect(isOpen(makeVenue({ hours: undefined }), SAT, []).status).toBe('unknown');
  });

  it('8. lastEntry가 설정된 시설은 결과에 lastEntry가 들어 있다', () => {
    const venue = makeVenue({ lastEntry: '17:00' });
    expect(isOpen(venue, TUE, [])).toEqual({
      status: 'open',
      open: '10:00',
      close: '18:00',
      lastEntry: '17:00',
    });
  });

  it('9. 공휴일 인자가 빈 배열이어도 정상 동작한다', () => {
    const venue = makeVenue({ closed: { weekday: 'mon', ifHoliday: 'nextDay' } });
    expect(isOpen(venue, MON, []).status).toBe('closed');
    expect(isOpen(venue, TUE, []).status).toBe('open');
  });

  it('10. 같은 입력을 두 번 넣어도 결과가 같다', () => {
    const venue = makeVenue({ closed: { weekday: 'mon', ifHoliday: 'nextDay' }, lastEntry: '17:30' });
    const holidays = [MON];
    expect(isOpen(venue, TUE, holidays)).toEqual(isOpen(venue, TUE, holidays));
    expect(isOpen(venue, MON, holidays)).toEqual(isOpen(venue, MON, holidays));
  });
});
