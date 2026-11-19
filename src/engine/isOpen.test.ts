import { describe, it, expect } from 'vitest';
import type { Venue } from '../types';
import { effectiveWeekday, isOpen, venueLastEntry } from './isOpen';
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

// 2026-11-13 금, 2027-01-01 금
const FRI = '2026-11-13';
const NEW_YEAR = '2027-01-01';
const FRI_LATE = { open: '10:00', close: '21:00' };
const SUN_SHORT = { open: '10:00', close: '18:00' };

describe("isOpen: ifHoliday 'open'", () => {
  const venue = makeVenue({ closed: { weekday: 'mon', ifHoliday: 'open' } });

  it('휴관 요일(월)이 공휴일이면 open', () => {
    expect(isOpen(venue, MON, [MON]).status).toBe('open');
  });

  it("다음 날(화)은 대체 휴관 없이 open ('nextDay'와 다른 점)", () => {
    expect(isOpen(venue, TUE, [MON]).status).toBe('open');
  });

  it('공휴일이 아닌 월요일은 그대로 closed', () => {
    expect(isOpen(venue, MON, [])).toEqual({ status: 'closed', reason: REASONS.CLOSED_WEEKDAY('월') });
  });
});

describe('effectiveWeekday', () => {
  it('공휴일이고 holidayAs가 있으면 그 요일', () => {
    expect(effectiveWeekday(makeVenue({ holidayAs: 'sun' }), FRI, [FRI])).toBe('sun');
  });

  it('공휴일이 아니면 실제 요일', () => {
    expect(effectiveWeekday(makeVenue({ holidayAs: 'sun' }), FRI, [])).toBe('fri');
  });

  it('holidayAs가 없으면 공휴일이어도 실제 요일', () => {
    expect(effectiveWeekday(makeVenue(), FRI, [FRI])).toBe('fri');
  });
});

describe('isOpen: holidayAs (공휴일 운영시간)', () => {
  const hours = { tue: DAILY, wed: DAILY, thu: DAILY, fri: FRI_LATE, sat: SUN_SHORT, sun: SUN_SHORT };

  it('공휴일인 금요일은 일요일 시간으로 open (OpenStatus 모양은 그대로)', () => {
    const venue = makeVenue({ hours, holidayAs: 'sun', lastEntry: '17:00' });
    expect(isOpen(venue, FRI, [FRI])).toEqual({ status: 'open', open: '10:00', close: '18:00', lastEntry: '17:00' });
    // 공휴일이 아니면 금요일 시간
    expect(isOpen(venue, FRI, [])).toEqual({ status: 'open', open: '10:00', close: '21:00', lastEntry: '17:00' });
  });

  it("ifHoliday 'open' + holidayAs: hours.mon이 없어도 공휴일 월요일은 일요일 시간으로 open", () => {
    const venue = makeVenue({ hours, closed: { weekday: 'mon', ifHoliday: 'open' }, holidayAs: 'sun' });
    expect(isOpen(venue, MON, [MON])).toEqual({ status: 'open', open: '10:00', close: '18:00', lastEntry: undefined });
  });

  it("'nextDay' 시설의 공휴일 월요일: 일요일 시간으로 open, 다음 날(화)은 CLOSED_HOLIDAY", () => {
    const venue = makeVenue({ hours, closed: { weekday: 'mon', ifHoliday: 'nextDay' }, holidayAs: 'sun' });
    expect(isOpen(venue, MON, [MON])).toEqual({ status: 'open', open: '10:00', close: '18:00', lastEntry: undefined });
    expect(isOpen(venue, TUE, [MON])).toEqual({ status: 'closed', reason: REASONS.CLOSED_HOLIDAY });
  });

  it("closed.dates가 공휴일보다 우선: 1/1이 공휴일이어도 CLOSED_DATE", () => {
    const venue = makeVenue({ hours, closed: { weekday: 'mon', ifHoliday: 'open', dates: ['01-01'] }, holidayAs: 'sun' });
    expect(isOpen(venue, NEW_YEAR, [NEW_YEAR])).toEqual({ status: 'closed', reason: REASONS.CLOSED_DATE });
  });

  it('holidayAs 요일의 hours가 없으면 unknown(MISSING_HOURS)', () => {
    const { sun: _sun, ...noSun } = hours;
    void _sun;
    const venue = makeVenue({ hours: noSun, holidayAs: 'sun' });
    expect(isOpen(venue, FRI, [FRI])).toEqual({ status: 'unknown', reason: REASONS.MISSING_HOURS });
  });
});

describe('venueLastEntry', () => {
  const hours = { tue: DAILY, fri: FRI_LATE };

  it('lastEntryBeforeClose가 있으면 그 요일 폐관 − N분', () => {
    const venue = makeVenue({ hours, lastEntryBeforeClose: 60 });
    expect(venueLastEntry(venue, 'tue')).toBe('17:00');
    expect(venueLastEntry(venue, 'fri')).toBe('20:00');
  });

  it('lastEntryBeforeClose가 lastEntry보다 우선', () => {
    expect(venueLastEntry(makeVenue({ hours, lastEntry: '17:30', lastEntryBeforeClose: 60 }), 'fri')).toBe('20:00');
  });

  it('없으면 lastEntry, 둘 다 없으면 undefined', () => {
    expect(venueLastEntry(makeVenue({ hours, lastEntry: '17:30' }), 'fri')).toBe('17:30');
    expect(venueLastEntry(makeVenue({ hours }), 'fri')).toBeUndefined();
  });

  it('폐관 − N이 개관보다 일러도 그대로 둔다. 00:00보다 이르면 00:00', () => {
    expect(venueLastEntry(makeVenue({ hours, lastEntryBeforeClose: 600 }), 'tue')).toBe('08:00');
    expect(venueLastEntry(makeVenue({ hours, lastEntryBeforeClose: 2000 }), 'tue')).toBe('00:00');
  });

  it("N이 음수거나 수가 아니면 ''(형식 오류)", () => {
    expect(venueLastEntry(makeVenue({ hours, lastEntryBeforeClose: -10 }), 'tue')).toBe('');
    expect(venueLastEntry(makeVenue({ hours, lastEntryBeforeClose: Number.NaN }), 'tue')).toBe('');
  });

  it('그 요일 hours가 없으면 lastEntry', () => {
    expect(venueLastEntry(makeVenue({ hours, lastEntry: '17:30', lastEntryBeforeClose: 60 }), 'sun')).toBe('17:30');
  });
});
