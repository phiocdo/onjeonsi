import { describe, it, expect } from 'vitest';
import type { DaySchedule, ParsedOperatingHours, Weekday } from '../types';
import { parseHours } from '../lib/parseHours';
import { scheduleForDate, weekOfMonth, isSessionDay } from './scheduleForDate';

// 2026-11-14 토(둘째 주), 2026-11-17 화, 2026-11-21 토(셋째 주)
function closedDay(): DaySchedule {
  return { isOpen: false, intervals: [] };
}
function open(o: string, c: string): DaySchedule {
  return { isOpen: true, intervals: [{ open: o, close: c }] };
}
function makeHours(
  days: Partial<Record<Weekday, DaySchedule>>,
  extra: Partial<ParsedOperatingHours> = {},
): ParsedOperatingHours {
  return {
    scheduleType: 'scheduled',
    weekdays: {
      mon: closedDay(), tue: closedDay(), wed: closedDay(), thu: closedDay(),
      fri: closedDay(), sat: closedDay(), sun: closedDay(),
      ...days,
    },
    holiday: null,
    exceptions: [],
    ...extra,
  };
}

describe('weekOfMonth: 1~7일이 1째 주', () => {
  it.each([
    ['2026-11-01', 1],
    ['2026-11-07', 1],
    ['2026-11-08', 2],
    ['2026-11-21', 3],
    ['2026-11-28', 4],
    ['2026-11-29', 5],
    // 7월 1일은 수요일. 7월 6일(월)은 달력으로는 둘째 줄이지만 첫째 월요일이다
    ['2026-07-06', 1],
  ])('%s → %i', (date, week) => {
    expect(weekOfMonth(date)).toBe(week);
  });
});

describe('scheduleForDate', () => {
  it.each(['always_open', 'unknown'] as const)('scheduleType %s → null', (scheduleType) => {
    expect(scheduleForDate(makeHours({ tue: open('10:00', '18:00') }, { scheduleType }), '2026-11-17', [])).toBeNull();
  });

  it('특별한 것이 없으면 기본 요일 일정', () => {
    const hours = makeHours({ tue: open('10:00', '18:00') });
    expect(scheduleForDate(hours, '2026-11-17', [])).toEqual(open('10:00', '18:00'));
    expect(scheduleForDate(hours, '2026-11-18', [])).toEqual(closedDay());
  });

  it('① exceptions가 가장 우선 (공휴일이어도)', () => {
    const hours = makeHours(
      { tue: open('10:00', '18:00') },
      {
        exceptions: [{ date: '2026-11-17', schedule: open('14:00', '16:00') }],
        holiday: closedDay(),
        periods: [{ from: '2026-11-01', weekdays: makeHours({ tue: open('10:00', '21:00') }).weekdays }],
      },
    );
    expect(scheduleForDate(hours, '2026-11-17', ['2026-11-17'])).toEqual(open('14:00', '16:00'));
  });

  it('② 기간이 맞는 periods 중 from이 가장 늦은 것', () => {
    const hours = makeHours(
      { tue: open('10:00', '18:00') },
      {
        // 순서가 최근 순이 아니다
        periods: [
          { from: '2026-11-10', weekdays: makeHours({ tue: open('10:00', '21:00') }).weekdays },
          { from: '2026-09-01', weekdays: makeHours({ tue: open('10:00', '20:00') }).weekdays },
          { from: '2026-12-01', weekdays: makeHours({ tue: open('10:00', '22:00') }).weekdays },
        ],
      },
    );
    expect(scheduleForDate(hours, '2026-08-25', [])).toEqual(open('10:00', '18:00'));
    expect(scheduleForDate(hours, '2026-11-03', [])).toEqual(open('10:00', '20:00'));
    expect(scheduleForDate(hours, '2026-11-10', [])).toEqual(open('10:00', '21:00'));
    expect(scheduleForDate(hours, '2026-12-01', [])).toEqual(open('10:00', '22:00'));
  });

  it('② to가 지나면 그 기간은 쓰지 않는다. from이 없으면 처음부터', () => {
    const hours = makeHours(
      { tue: open('10:00', '18:00') },
      { periods: [{ to: '2026-11-10', weekdays: makeHours({ tue: open('09:00', '18:00') }).weekdays }] },
    );
    expect(scheduleForDate(hours, '2026-11-10', [])).toEqual(open('09:00', '18:00'));
    expect(scheduleForDate(hours, '2026-11-17', [])).toEqual(open('10:00', '18:00'));
  });

  it('parseHours의 "N일부터" periods를 날짜에 맞춰 고른다', () => {
    const hours = parseHours('화-일 10:00~18:00 / 11.20.(금)부터 금,토 21:00까지', 2026);
    expect(hours.periods?.length).toBe(1);
    expect(scheduleForDate(hours, '2026-11-14', [])?.intervals).toEqual([{ open: '10:00', close: '18:00' }]);
    expect(scheduleForDate(hours, '2026-11-21', [])?.intervals).toEqual([{ open: '10:00', close: '21:00' }]);
  });

  it('④ 공휴일이고 holiday가 있으면 holiday 일정, holiday가 null이면 요일 일정', () => {
    const withHoliday = makeHours({ tue: open('10:00', '18:00') }, { holiday: closedDay() });
    expect(scheduleForDate(withHoliday, '2026-11-17', ['2026-11-17'])).toEqual(closedDay());
    expect(scheduleForDate(withHoliday, '2026-11-17', [])).toEqual(open('10:00', '18:00'));
    const noHoliday = makeHours({ tue: open('10:00', '18:00') });
    expect(scheduleForDate(noHoliday, '2026-11-17', ['2026-11-17'])).toEqual(open('10:00', '18:00'));
  });

  it('⑤ weeksOfMonth에 없는 주는 휴관', () => {
    const hours = parseHours('첫째·셋째 주 토요일 10:00~12:00', 2026);
    expect(hours.weekdays.sat.weeksOfMonth).toEqual([1, 3]);
    expect(scheduleForDate(hours, '2026-11-21', [])).toMatchObject({ isOpen: true, intervals: [{ open: '10:00', close: '12:00' }] });
    expect(scheduleForDate(hours, '2026-11-14', [])).toMatchObject({ isOpen: false, intervals: [] });
    expect(scheduleForDate(hours, '2026-11-07', [])?.isOpen).toBe(true);
  });

  it('⑤ 1~7일 방식: 7월 6일(월)은 첫째 월요일', () => {
    const hours = makeHours({ mon: { ...open('10:00', '12:00'), weeksOfMonth: [1] } });
    expect(scheduleForDate(hours, '2026-07-06', [])?.isOpen).toBe(true);
    expect(scheduleForDate(hours, '2026-07-13', [])?.isOpen).toBe(false);
  });

  it('입력을 바꾸지 않는다', () => {
    const hours = makeHours({ sat: { ...open('10:00', '12:00'), weeksOfMonth: [1] } });
    const before = structuredClone(hours);
    scheduleForDate(hours, '2026-11-14', []);
    expect(hours).toEqual(before);
  });
});

describe('isSessionDay', () => {
  it('note에 회차가 있으면 회차', () => {
    expect(isSessionDay({ ...open('14:00', '15:20'), note: '회차 운영' })).toBe(true);
    expect(isSessionDay({ ...open('14:00', '15:20'), note: '회차 운영 · 연장 운영' })).toBe(true);
    expect(isSessionDay({ ...open('10:00', '21:00'), note: '연장 운영' })).toBe(false);
    expect(isSessionDay(open('10:00', '18:00'))).toBe(false);
  });

  it('sessions가 있으면 note보다 sessions를 본다', () => {
    const withSessions = (sessions: unknown, note?: string) =>
      ({ ...open('14:00', '15:20'), sessions, note }) as DaySchedule;
    expect(isSessionDay(withSessions([{ start: '14:00' }]))).toBe(true);
    expect(isSessionDay(withSessions([], '회차 운영'))).toBe(false);
  });
});
