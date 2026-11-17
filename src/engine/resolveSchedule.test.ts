import { describe, it, expect } from 'vitest';
import type { DaySchedule, Exhibition, ParsedOperatingHours, Venue, Weekday } from '../types';
import { parseHours } from '../lib/parseHours';
import { resolveSchedule, judgeResolved } from './resolveSchedule';
import { judge } from './judge';
import { REASONS } from './reasons';

// 날짜: 2026-11-17 화, 2026-11-21 토, 2026-11-23 월
const TUE = '2026-11-17';
const SAT = '2026-11-21';
const MON = '2026-11-23';

const ON = { useExhibitionHours: true };
const OFF = { useExhibitionHours: false };

// data/venues/venue-craft-museum.json과 같은 모양
function craftMuseum(overrides?: Partial<Venue>): Venue {
  return {
    id: 'venue-craft-museum',
    name: '서울공예박물관',
    aliases: ['서울공예박물관'],
    gu: '종로구',
    type: '박물관',
    lat: 37.5778,
    lng: 126.9934,
    representative: false,
    hours: {
      tue: { open: '10:00', close: '18:00' },
      wed: { open: '10:00', close: '18:00' },
      thu: { open: '10:00', close: '18:00' },
      fri: { open: '10:00', close: '21:00' },
      sat: { open: '10:00', close: '19:00' },
      sun: { open: '10:00', close: '19:00' },
    },
    closed: { weekday: 'mon' },
    lastEntry: '20:00',
    visitMinutes: 90,
    source: '서울시 운영정보',
    verified: '2026-11-09',
    ...overrides,
  };
}

const exhibition: Exhibition = {
  id: 'e1',
  venueId: '',
  title: '테스트 전시',
  start: '2026-11-01',
  end: '2026-11-30',
};

function closedDay(): DaySchedule {
  return { isOpen: false, intervals: [] };
}

/** 요일별 값을 받아 ParsedOperatingHours를 만든다. 안 준 요일은 isOpen: false. */
function makeHours(
  days: Partial<Record<Weekday, DaySchedule>>,
  scheduleType: ParsedOperatingHours['scheduleType'] = 'scheduled',
): ParsedOperatingHours {
  const weekdays = {
    mon: closedDay(), tue: closedDay(), wed: closedDay(), thu: closedDay(),
    fri: closedDay(), sat: closedDay(), sun: closedDay(),
    ...days,
  };
  return { scheduleType, weekdays, holiday: null, exceptions: [] };
}

function open(o: string, c: string, lastAdmission?: string): DaySchedule {
  return { isOpen: true, intervals: [lastAdmission ? { open: o, close: c, lastAdmission } : { open: o, close: c }] };
}

function run(resolved: ReturnType<typeof resolveSchedule>, date: string, stayStart: string, stayEnd: string) {
  return judgeResolved({ exhibition, date, stayStart, stayEnd, holidays: [] }, resolved);
}

describe('resolveSchedule: 플래그 off', () => {
  it('시설 그대로 쓰고 전시는 무시한다. mismatches는 계산한다', () => {
    const venue = craftMuseum();
    const hours = makeHours({ sat: open('10:00', '18:00') });
    const r = resolveSchedule(venue, hours, OFF);

    expect(r.basis).toBe('venue');
    expect(r.venue?.basis).toBe('venue');
    expect(r.venue?.hours).toEqual(venue.hours);
    expect(r.venue?.lastEntryByDay).toBeUndefined();
    expect(r.mismatches).toEqual([
      { weekday: 'sat', kind: 'close', venueValue: '19:00', exhibitionValue: '18:00' },
    ]);
    // 토 17:00~20:00, 시설 폐관 19:00 → 90분 관람 가능
    expect(run(r, SAT, '17:00', '20:00')).toMatchObject({ result: 'possible', basis: 'venue' });
  });

  it('옵션을 안 주면 off다', () => {
    const r = resolveSchedule(craftMuseum(), makeHours({ sat: open('10:00', '18:00') }));
    expect(r.basis).toBe('venue');
  });

  it('시설 없음 + 플래그 off → venue null, judgeResolved는 MISSING_VENUE', () => {
    const r = resolveSchedule(null, parseHours('화-일 10:00~18:00', 2026), OFF);
    expect(r).toEqual({ venue: null, basis: null, mismatches: [] });
    expect(run(r, TUE, '10:00', '12:00')).toEqual({ result: 'unknown', reasons: [REASONS.MISSING_VENUE] });
  });

  it('둘 다 없으면 venue null', () => {
    expect(resolveSchedule(null, undefined, ON)).toEqual({ venue: null, basis: null, mismatches: [] });
  });
});

describe('resolveSchedule: 시설 없음 + 플래그 on', () => {
  it('"화-일 10:00~18:00" → basis exhibition, 화요일 판정 가능', () => {
    const r = resolveSchedule(null, parseHours('화-일 10:00~18:00', 2026), ON);
    expect(r.basis).toBe('exhibition');
    expect(r.venue?.basis).toBe('exhibition');
    expect(r.venue?.hours?.tue).toEqual({ open: '10:00', close: '18:00' });
    // 월요일은 isOpen: false라 "모름" → hours에서 빠지고 closed도 넣지 않는다
    expect(r.venue?.hours?.mon).toBeUndefined();
    expect(r.venue?.closed).toBeUndefined();

    // 입장 마감이 없으니 폐관(18:00)을 입장 마감으로 보고 판정한다
    expect(run(r, TUE, '10:00', '12:00')).toEqual({
      result: 'possible',
      reasons: [],
      entryTime: '10:00',
      endTime: '11:00',
      slackMinutes: 60,
      basis: 'exhibition',
      lastEntryAssumed: true,
    });
    // 폐관 전 관람 시간 부족은 판정할 수 있다
    expect(run(r, TUE, '17:30', '20:00')).toMatchObject({ result: 'impossible', basis: 'exhibition' });
    // 월요일은 가능도 불가도 아닌 확인 필요
    expect(run(r, MON, '10:00', '12:00')).toMatchObject({ result: 'unknown', reasons: [REASONS.MISSING_HOURS] });
  });

  it('lastAdmission이 있으면 lastEntryByDay로 넣어 가능 판정을 낸다', () => {
    const r = resolveSchedule(null, makeHours({ tue: open('10:00', '18:00', '17:00') }), ON);
    expect(r.venue?.lastEntryByDay).toEqual({ tue: '17:00' });
    expect(run(r, TUE, '10:00', '12:00')).toMatchObject({ result: 'possible', basis: 'exhibition' });
    expect(run(r, TUE, '17:10', '18:30')).toMatchObject({ result: 'impossible' });
  });

  it('lastAdmission이 폐관보다 늦으면 넣지 않는다', () => {
    const r = resolveSchedule(null, makeHours({ tue: open('10:00', '18:00', '19:00') }), ON);
    expect(r.venue?.lastEntryByDay).toEqual({});
  });

  it.each(['always_open', 'unknown'] as const)('scheduleType %s → venue null', (scheduleType) => {
    const hours = makeHours({ tue: open('10:00', '18:00') }, scheduleType);
    const r = resolveSchedule(null, hours, ON);
    expect(r).toEqual({ venue: null, basis: null, mismatches: [] });
    expect(run(r, TUE, '10:00', '12:00').reasons).toEqual([REASONS.MISSING_VENUE]);
  });

  it('믿을 수 있는 요일이 하나도 없으면 venue null', () => {
    const r = resolveSchedule(null, makeHours({}), ON);
    expect(r.venue).toBeNull();
  });
});

describe('resolveSchedule: 믿을 수 있는 요일', () => {
  it('isOpen: false, open >= close, 형식 오류, 빈 구간은 모름. 구간 둘 이상은 믿는다', () => {
    const hours = makeHours({
      mon: { isOpen: false, intervals: [{ open: '10:00', close: '18:00' }] },
      tue: { isOpen: true, intervals: [{ open: '10:00', close: '12:00' }, { open: '13:00', close: '18:00' }] },
      wed: open('18:00', '10:00'),
      thu: open('9:00', '18:00'),
      fri: { isOpen: true, intervals: [] },
      sat: open('11:00', '17:00'),
    });
    const r = resolveSchedule(null, hours, ON);
    expect(r.basis).toBe('exhibition');
    expect(r.venue?.hours).toEqual({
      tue: { open: '10:00', close: '18:00' },
      sat: { open: '11:00', close: '17:00' },
    });
    expect(r.venue?.intervalsByDay).toEqual({
      tue: [{ open: '10:00', close: '12:00' }, { open: '13:00', close: '18:00' }],
    });
  });

  it('시설과 함께일 때 구간 둘인 요일은 구간마다 겹치는 시간, mismatch는 첫 시작·마지막 끝과 비교', () => {
    const hours = makeHours({
      tue: { isOpen: true, intervals: [{ open: '10:00', close: '12:00' }, { open: '13:00', close: '16:00' }] },
      sat: open('10:00', '18:00'),
    });
    const r = resolveSchedule(craftMuseum(), hours, ON);
    expect(r.basis).toBe('merged');
    expect(r.venue?.hours?.tue).toEqual({ open: '10:00', close: '16:00' });
    expect(r.venue?.lastEntryByDay?.tue).toBeUndefined();
    // 시설 입장 마감 20:00은 구간마다 그 구간 끝으로 줄어든다
    expect(r.venue?.intervalsByDay?.tue).toEqual([
      { open: '10:00', close: '12:00', lastEntry: '12:00' },
      { open: '13:00', close: '16:00', lastEntry: '16:00' },
    ]);
    expect(r.mismatches).toEqual([
      { weekday: 'tue', kind: 'close', venueValue: '18:00', exhibitionValue: '16:00' },
      { weekday: 'sat', kind: 'close', venueValue: '19:00', exhibitionValue: '18:00' },
    ]);
  });
});

describe('resolveSchedule: 둘 다 있음 + 플래그 on (merged)', () => {
  it('공예박물관 토: 시설 10~19, 전시 10~18 → 17:00~20:00은 불가(겹치는 시간 18:00)', () => {
    const r = resolveSchedule(craftMuseum(), makeHours({ sat: open('10:00', '18:00') }), ON);
    expect(r.basis).toBe('merged');
    expect(r.venue?.hours?.sat).toEqual({ open: '10:00', close: '18:00' });
    expect(run(r, SAT, '17:00', '20:00')).toEqual({
      result: 'impossible',
      reasons: [REASONS.NOT_ENOUGH_BEFORE_CLOSE],
      basis: 'merged',
    });
  });

  it('시립 화: 시설 10~18, 전시 10~20 → 겹치는 시간 10~18, mismatch(close)', () => {
    const sema = craftMuseum({ id: 'venue-sema', name: '서울시립미술관(SeMA)' });
    const r = resolveSchedule(sema, makeHours({ tue: open('10:00', '20:00') }), ON);
    expect(r.venue?.hours?.tue).toEqual({ open: '10:00', close: '18:00' });
    expect(r.mismatches).toEqual([
      { weekday: 'tue', kind: 'close', venueValue: '18:00', exhibitionValue: '20:00' },
    ]);
    // 입장 마감 20:00은 그날 폐관 18:00으로 줄어든다
    expect(r.venue?.lastEntryByDay?.tue).toBe('18:00');
  });

  it('공예박물관 월: 시설 월 휴관, 전시 월 10~18 → 불가, mismatch(closed)', () => {
    const r = resolveSchedule(craftMuseum(), makeHours({ mon: open('10:00', '18:00') }), ON);
    expect(r.venue?.hours?.mon).toBeUndefined();
    expect(r.venue?.closed).toEqual({ weekday: 'mon' });
    expect(run(r, MON, '10:00', '12:00')).toEqual({
      result: 'impossible',
      reasons: [REASONS.CLOSED_WEEKDAY('월')],
      basis: 'merged',
    });
    expect(r.mismatches).toEqual([
      { weekday: 'mon', kind: 'closed', venueValue: 'closed', exhibitionValue: '10:00~18:00' },
    ]);
  });

  it('입장 마감: 시설 20:00, 전시 17:30, 그날 폐관 18:00 → 17:30', () => {
    const r = resolveSchedule(craftMuseum(), makeHours({ tue: open('10:00', '18:00', '17:30') }), ON);
    expect(r.venue?.lastEntryByDay?.tue).toBe('17:30');
    expect(r.mismatches).toContainEqual({
      weekday: 'tue', kind: 'lastEntry', venueValue: '20:00', exhibitionValue: '17:30',
    });
    expect(run(r, TUE, '17:40', '20:00').reasons).toContain(REASONS.AFTER_LAST_ENTRY('17:30'));
  });

  it('겹치는 시간이 없으면 그 요일은 hours에서 뺀다', () => {
    const r = resolveSchedule(craftMuseum(), makeHours({ tue: open('19:00', '21:00') }), ON);
    expect(r.venue?.hours?.tue).toBeUndefined();
    expect(r.venue?.hours?.wed).toEqual({ open: '10:00', close: '18:00' });
    expect(run(r, TUE, '10:00', '12:00')).toMatchObject({ result: 'unknown', reasons: [REASONS.MISSING_HOURS] });
  });

  it('늦은 개관을 쓰고 mismatch(open)를 남긴다', () => {
    const r = resolveSchedule(craftMuseum(), makeHours({ wed: open('11:00', '18:00') }), ON);
    expect(r.venue?.hours?.wed).toEqual({ open: '11:00', close: '18:00' });
    expect(r.mismatches).toEqual([
      { weekday: 'wed', kind: 'open', venueValue: '10:00', exhibitionValue: '11:00' },
    ]);
  });

  it('시설에 없는 요일은 전시가 있어도 넣지 않는다', () => {
    const venue = craftMuseum({ closed: undefined });
    const r = resolveSchedule(venue, makeHours({ mon: open('10:00', '18:00') }), ON);
    expect(r.venue?.hours?.mon).toBeUndefined();
  });

  it('전시가 always_open이면 시설만 쓴다(basis venue)', () => {
    const r = resolveSchedule(craftMuseum(), makeHours({ tue: open('00:00', '23:59') }, 'always_open'), ON);
    expect(r.basis).toBe('venue');
    expect(r.mismatches).toEqual([]);
  });
});

describe('resolveSchedule: 입력을 바꾸지 않는다', () => {
  function deepFreeze<T>(obj: T): T {
    if (obj && typeof obj === 'object') {
      Object.values(obj).forEach(deepFreeze);
      Object.freeze(obj);
    }
    return obj;
  }

  it.each([OFF, ON])('옵션 %o', (options) => {
    const venue = craftMuseum({ closed: { weekday: 'mon', dates: ['2026-12-25'] } });
    const hours = makeHours({ tue: open('11:00', '17:00', '16:30'), mon: open('10:00', '18:00') });
    const venueBefore = structuredClone(venue);
    const hoursBefore = structuredClone(hours);
    deepFreeze(venue);
    deepFreeze(hours);

    const r = resolveSchedule(venue, hours, options);
    expect(venue).toEqual(venueBefore);
    expect(hours).toEqual(hoursBefore);
    expect(r.venue).not.toBe(venue);

    // 결과를 고쳐도 원본은 그대로
    r.venue!.hours!.wed!.open = '00:00';
    r.venue!.closed!.dates!.push('2026-01-01');
    expect(venue).toEqual(venueBefore);
  });
});

describe('resolveSchedule: 회차·겹치는 구간은 모름', () => {
  it('note에 회차가 있는 요일은 구간 수와 상관없이 믿지 않는다', () => {
    const hours = makeHours({
      tue: { ...open('14:00', '15:20'), note: '회차 운영' },
      wed: {
        isOpen: true,
        intervals: [{ open: '14:00', close: '15:20' }, { open: '16:00', close: '17:20' }],
        note: '회차 운영',
      },
      sat: open('10:00', '18:00'),
    });
    const r = resolveSchedule(null, hours, ON);
    expect(r.venue?.hours).toEqual({ sat: { open: '10:00', close: '18:00' } });
    expect(r.venue?.intervalsByDay).toBeUndefined();
  });

  it('구간이 겹치면 믿지 않는다', () => {
    const hours = makeHours({
      tue: { isOpen: true, intervals: [{ open: '10:00', close: '18:00' }, { open: '14:00', close: '16:00' }] },
    });
    expect(resolveSchedule(null, hours, ON).venue).toBeNull();
  });
});

describe('resolveSchedule: 구간이 여러 개인 날 (점심 휴관)', () => {
  // "10:00~18:00 (※ 12~13시 휴관) 입장마감 17:00"
  const lunch = parseHours('10:00~18:00 (※ 12~13시 휴관) 입장마감 17:00', 2026);

  it('parseHours 결과를 그대로 받아 구간 둘로 판정한다 (exhibition)', () => {
    expect(lunch.weekdays.tue.intervals).toEqual([
      { open: '10:00', close: '12:00' },
      { open: '13:00', close: '18:00', lastAdmission: '17:00' },
    ]);
    const r = resolveSchedule(null, lunch, ON);
    expect(r.venue?.intervalsByDay?.tue).toEqual([
      { open: '10:00', close: '12:00' },
      { open: '13:00', close: '18:00', lastEntry: '17:00' },
    ]);
    expect(run(r, TUE, '11:30', '14:30')).toMatchObject({ result: 'possible', entryTime: '13:00', endTime: '14:00' });
    expect(run(r, TUE, '10:00', '12:00')).toMatchObject({ result: 'possible', entryTime: '10:00', lastEntryAssumed: true });
    expect(run(r, TUE, '12:00', '13:30')).toMatchObject({ result: 'impossible', reasons: [REASONS.NOT_ENOUGH_STAY] });
  });

  it('시설과 합치면 구간마다 시설 시간과 겹치는 부분 (공예박물관 화 10~18, 입장 마감 20:00)', () => {
    const r = resolveSchedule(craftMuseum(), lunch, ON);
    expect(r.venue?.intervalsByDay?.tue).toEqual([
      { open: '10:00', close: '12:00', lastEntry: '12:00' },
      { open: '13:00', close: '18:00', lastEntry: '17:00' },
    ]);
    // 90분 관람: 오전 구간은 10:30 이후 불가, 오후 구간 13:00 입장
    expect(run(r, TUE, '11:00', '15:00')).toMatchObject({ result: 'possible', entryTime: '13:00', endTime: '14:30', basis: 'merged' });
  });

  it('겹치는 구간이 하나만 남으면 구간 하나짜리로 넣는다', () => {
    const venue = craftMuseum({ hours: { tue: { open: '13:00', close: '18:00' } } });
    const r = resolveSchedule(venue, lunch, ON);
    expect(r.venue?.hours?.tue).toEqual({ open: '13:00', close: '18:00' });
    expect(r.venue?.lastEntryByDay?.tue).toBe('17:00');
    expect(r.venue?.intervalsByDay).toBeUndefined();
  });

  it('플래그 off면 구간과 상관없이 시설만', () => {
    const r = resolveSchedule(craftMuseum(), lunch, OFF);
    expect(r.venue?.intervalsByDay).toBeUndefined();
    expect(r.venue?.hours).toEqual(craftMuseum().hours);
  });
});

describe('judgeResolved: 판정 날짜의 일정 (scheduleForDate)', () => {
  const SAT_14 = '2026-11-14'; // 둘째 토요일
  const withHours = (operatingHours: ParsedOperatingHours): Exhibition => ({ ...exhibition, operatingHours });
  const runEx = (
    resolved: ReturnType<typeof resolveSchedule>,
    ex: Exhibition,
    date: string,
    stayStart: string,
    stayEnd: string,
    holidays: string[] = [],
  ) => judgeResolved({ exhibition: ex, date, stayStart, stayEnd, holidays }, resolved);

  it('플래그 off면 날짜 예외가 있어도 지금과 같다 (resolved.venue로 판정)', () => {
    const hours: ParsedOperatingHours = {
      ...makeHours({ sat: open('10:00', '18:00') }),
      exceptions: [{ date: SAT, schedule: closedDay() }],
    };
    const r = resolveSchedule(craftMuseum(), hours, OFF);
    expect(r.source).toBeUndefined();
    const ex = withHours(hours);
    expect(runEx(r, ex, SAT, '14:00', '17:00')).toEqual(
      judge({ venue: r.venue!, exhibition: ex, date: SAT, stayStart: '14:00', stayEnd: '17:00', holidays: [] }),
    );
    expect(runEx(r, ex, SAT, '14:00', '17:00').result).toBe('possible');
  });

  it('날짜에 특별한 것이 없으면 resolved.venue로 판정한 것과 같다', () => {
    const hours = parseHours('화-일 10:00~18:00 입장마감 17:30', 2026);
    const r = resolveSchedule(craftMuseum(), hours, ON);
    const ex = withHours(hours);
    for (const [date, s, e] of [[TUE, '10:00', '12:00'], [SAT, '17:00', '20:00'], [MON, '10:00', '12:00']]) {
      expect(runEx(r, ex, date, s, e)).toEqual(
        judge({ venue: r.venue!, exhibition: ex, date, stayStart: s, stayEnd: e, holidays: [] }),
      );
    }
  });

  it('날짜 예외로 여는 날: 기본 요일이 모름이어도 그날은 판정한다 (exhibition)', () => {
    const hours: ParsedOperatingHours = {
      ...makeHours({ tue: open('10:00', '18:00') }),
      exceptions: [{ date: SAT, schedule: open('14:00', '16:00') }],
    };
    const r = resolveSchedule(null, hours, ON);
    expect(r.venue?.hours?.sat).toBeUndefined();
    expect(runEx(r, withHours(hours), SAT, '13:00', '17:00')).toMatchObject({
      result: 'possible',
      entryTime: '14:00',
      endTime: '15:00',
      basis: 'exhibition',
      lastEntryAssumed: true,
    });
    // 예외는 그 날짜만
    expect(runEx(r, withHours(hours), SAT_14, '13:00', '17:00')).toMatchObject({ result: 'unknown', reasons: [REASONS.MISSING_HOURS] });
  });

  it('날짜 예외로 쉬는 날은 CLOSED_DATE (merged, exhibition 모두)', () => {
    const hours: ParsedOperatingHours = {
      ...makeHours({ sat: open('10:00', '18:00') }),
      exceptions: [{ date: SAT, schedule: closedDay() }],
    };
    const ex = withHours(hours);
    expect(runEx(resolveSchedule(craftMuseum(), hours, ON), ex, SAT, '14:00', '17:00')).toEqual({
      result: 'impossible', reasons: [REASONS.CLOSED_DATE], basis: 'merged',
    });
    expect(runEx(resolveSchedule(null, hours, ON), ex, SAT, '14:00', '17:00')).toEqual({
      result: 'impossible', reasons: [REASONS.CLOSED_DATE], basis: 'exhibition',
    });
  });

  it('시설도 쉬는 날이면 시설 사유를 그대로 둔다', () => {
    const hours: ParsedOperatingHours = {
      ...makeHours({ sat: open('10:00', '18:00') }),
      exceptions: [{ date: MON, schedule: closedDay() }],
    };
    expect(runEx(resolveSchedule(craftMuseum(), hours, ON), withHours(hours), MON, '10:00', '12:00').reasons)
      .toEqual([REASONS.CLOSED_WEEKDAY('월')]);
  });

  it('periods: from 이후에만 바뀐 시간 (야간개관)', () => {
    const hours = parseHours('화-일 10:00~18:00 / 11.20.(금)부터 금,토 21:00까지', 2026);
    const r = resolveSchedule(null, hours, ON);
    const ex = withHours(hours);
    expect(runEx(r, ex, SAT_14, '19:00', '21:00')).toMatchObject({ result: 'impossible', reasons: [REASONS.NOT_ENOUGH_BEFORE_CLOSE] });
    expect(runEx(r, ex, SAT, '19:00', '21:00')).toMatchObject({ result: 'possible', entryTime: '19:00', endTime: '20:00' });
  });

  it('공휴일 휴관이 적혀 있으면 공휴일은 CLOSED_DATE, 적혀 있지 않으면 요일 일정', () => {
    const hours = parseHours('화-일 10:00~18:00 (공휴일 휴관)', 2026);
    expect(hours.holiday).toEqual(closedDay());
    const r = resolveSchedule(null, hours, ON);
    expect(runEx(r, withHours(hours), SAT, '14:00', '17:00', [SAT])).toMatchObject({ result: 'impossible', reasons: [REASONS.CLOSED_DATE] });
    expect(runEx(r, withHours(hours), SAT, '14:00', '17:00', [])).toMatchObject({ result: 'possible' });

    const noRule = parseHours('화-일 10:00~18:00', 2026);
    expect(runEx(resolveSchedule(null, noRule, ON), withHours(noRule), SAT, '14:00', '17:00', [SAT]).result).toBe('possible');
  });

  it('weeksOfMonth: 쉬는 주에는 시설이 열어도 불가', () => {
    const hours = parseHours('첫째·셋째 주 토요일 10:00~12:00', 2026);
    const r = resolveSchedule(craftMuseum(), hours, ON);
    const ex = withHours(hours);
    // 셋째 토요일: 시설 10~19와 겹치는 10~12, 입장 마감은 시설 20:00 → 12:00
    expect(runEx(r, ex, SAT, '10:00', '12:00')).toMatchObject({ result: 'possible', entryTime: '10:00', basis: 'merged' });
    // 둘째 토요일
    expect(runEx(r, ex, SAT_14, '10:00', '12:00')).toEqual({ result: 'impossible', reasons: [REASONS.CLOSED_DATE], basis: 'merged' });
  });

  it('그날이 모름이면 지금처럼: merged는 시설 시간, exhibition은 MISSING_HOURS', () => {
    const hours = makeHours({ tue: open('10:00', '18:00') });
    const ex = withHours(hours);
    expect(runEx(resolveSchedule(craftMuseum(), hours, ON), ex, SAT, '17:00', '20:00')).toMatchObject({ result: 'possible', basis: 'merged' });
    expect(runEx(resolveSchedule(null, hours, ON), ex, SAT, '17:00', '20:00')).toMatchObject({ result: 'unknown', reasons: [REASONS.MISSING_HOURS] });
  });

  it('input.exhibition.operatingHours가 있으면 그것으로 그날 일정을 고른다', () => {
    const base = makeHours({ sat: open('10:00', '18:00') });
    const r = resolveSchedule(null, base, ON);
    const changed: ParsedOperatingHours = { ...base, exceptions: [{ date: SAT, schedule: closedDay() }] };
    expect(runEx(r, withHours(changed), SAT, '14:00', '17:00').reasons).toEqual([REASONS.CLOSED_DATE]);
    // 전시에 operatingHours가 없으면 resolveSchedule에 넘긴 hours를 쓴다
    expect(run(r, SAT, '14:00', '17:00').result).toBe('possible');
  });

  it('잘못된 날짜는 지금처럼 INVALID_INPUT', () => {
    const hours = makeHours({ sat: open('10:00', '18:00') });
    expect(runEx(resolveSchedule(null, hours, ON), withHours(hours), '2026-02-30', '14:00', '17:00').reasons)
      .toEqual([REASONS.INVALID_INPUT]);
  });
});
