import { describe, it, expect } from 'vitest';
import type { Venue, Exhibition, JudgeInput } from '../types';
import { judge, type ResolvedVenue } from './judge';
import { REASONS } from './reasons';

function makeVenue(overrides?: Partial<Venue>): Venue {
  return {
    id: 'v1',
    name: '테스트 시설',
    aliases: [],
    gu: '종로구',
    type: '미술관',
    lat: 37.5665,
    lng: 126.9780,
    representative: true,
    source: 'test',
    verified: '2026-11-10',
    hours: {
      tue: { open: '10:00', close: '18:00' },
    },
    lastEntry: '17:00',
    visitMinutes: 60,
    ...overrides,
  };
}

function makeExhibition(overrides?: Partial<Exhibition>): Exhibition {
  return {
    id: 'e1',
    venueId: 'v1',
    title: '테스트 전시',
    start: '2026-11-01',
    end: '2026-11-30',
    field: '미술',
    fetchedAt: '2026-11-10T00:00:00Z',
    ...overrides,
  };
}

interface MakeInputOverrides {
  venue?: Partial<Venue>;
  exhibition?: Partial<Exhibition>;
  date?: string;
  stayStart?: string;
  stayEnd?: string;
  holidays?: string[];
}

function makeInput(overrides?: MakeInputOverrides): JudgeInput {
  return {
    venue: makeVenue(overrides?.venue),
    exhibition: makeExhibition(overrides?.exhibition),
    date: overrides?.date ?? '2026-11-10',
    stayStart: overrides?.stayStart ?? '14:00',
    stayEnd: overrides?.stayEnd ?? '17:00',
    holidays: overrides?.holidays ?? [],
  };
}

describe('judge 판정 본체', () => {
  it('1. 모든 조건 통과 -> possible', () => {
    const result = judge(makeInput({ stayStart: '14:00', stayEnd: '17:00' }));
    expect(result.result).toBe('possible');
    expect(result.reasons).toEqual([]);
    expect(result.entryTime).toBe('14:00');
    expect(result.endTime).toBe('15:00');
    expect(result.slackMinutes).toBe(120);
  });

  it('2. 전시 기간 밖 -> impossible', () => {
    const result = judge(makeInput({ date: '2026-12-01' }));
    expect(result.result).toBe('impossible');
    expect(result.reasons).toEqual([REASONS.OUT_OF_PERIOD]);
  });

  it('3. 휴관일(closed.dates) -> impossible', () => {
    const result = judge(makeInput({ venue: { closed: { dates: ['2026-11-10'] } } }));
    expect(result.result).toBe('impossible');
    expect(result.reasons).toEqual([REASONS.CLOSED_DATE]);
  });

  it('4. 입장 마감 정각 -> possible', () => {
    const result = judge(makeInput({ stayStart: '17:00', stayEnd: '19:00', venue: { visitMinutes: 30 } }));
    expect(result.result).toBe('possible');
    expect(result.reasons).toEqual([]);
    expect(result.entryTime).toBe('17:00');
    expect(result.endTime).toBe('17:30');
  });

  it('5. 입장 마감 1분 뒤 -> impossible', () => {
    const result = judge(makeInput({ stayStart: '17:01', stayEnd: '19:00', venue: { visitMinutes: 30 } }));
    expect(result.result).toBe('impossible');
    expect(result.reasons).toEqual([REASONS.AFTER_LAST_ENTRY('17:00')]);
  });

  it('6. s + d가 폐관(18:00)과 정확히 같음 -> possible', () => {
    const result = judge(makeInput({ stayStart: '17:00', stayEnd: '18:00', venue: { visitMinutes: 60 } }));
    expect(result.result).toBe('possible');
    expect(result.reasons).toEqual([]);
    expect(result.entryTime).toBe('17:00');
    expect(result.endTime).toBe('18:00');
  });

  it('7. s + d가 폐관을 1분 넘음 -> impossible', () => {
    const result = judge(makeInput({ stayStart: '17:00', stayEnd: '19:00', venue: { visitMinutes: 61 } }));
    expect(result.result).toBe('impossible');
    expect(result.reasons).toEqual([REASONS.NOT_ENOUGH_BEFORE_CLOSE]);
  });

  it('8. s + d가 머물 수 있는 끝을 넘음 -> impossible', () => {
    const result = judge(makeInput({ stayStart: '14:00', stayEnd: '14:30' }));
    expect(result.result).toBe('impossible');
    expect(result.reasons).toEqual([REASONS.NOT_ENOUGH_STAY]);
  });

  it('9. 해당 요일 hours 없음 -> unknown', () => {
    const result = judge(makeInput({ venue: { hours: {} } }));
    expect(result.result).toBe('unknown');
    expect(result.reasons).toEqual([REASONS.MISSING_HOURS]);
  });

  it('10. lastEntry 없음 + 나머지 통과 -> 폐관 시각을 입장 마감으로 보고 possible (lastEntryAssumed)', () => {
    const result = judge(makeInput({ venue: { lastEntry: undefined } }));
    expect(result).toEqual({
      result: 'possible',
      reasons: [],
      entryTime: '14:00',
      endTime: '15:00',
      slackMinutes: 120,
      basis: 'venue',
      lastEntryAssumed: true,
    });
  });

  it('11. 어긴 조건이 있고 lastEntry도 없음 -> impossible (사유에 누락 정보가 섞이지 않음)', () => {
    const result = judge(makeInput({ date: '2026-10-01', venue: { lastEntry: undefined } }));
    expect(result.result).toBe('impossible');
    expect(result.reasons).toEqual([REASONS.OUT_OF_PERIOD]);
  });
});

// ResolvedVenue 전용 필드(lastEntryByDay, basis)를 넣은 입력을 만든다
function makeResolvedInput(
  venue: Omit<ResolvedVenue, keyof Venue> & Partial<Venue>,
  overrides?: Omit<MakeInputOverrides, 'venue'>,
): JudgeInput {
  const resolved: ResolvedVenue = { ...makeVenue(), ...venue };
  return { ...makeInput(overrides), venue: resolved };
}

describe('judge 입력 검사', () => {
  const INVALID = { result: 'unknown', reasons: [REASONS.INVALID_INPUT], basis: 'venue' };

  it.each([
    ['2026/11/10'],
    ['2026-11-1'],
    ['20261110'],
    [''],
  ])('날짜 형식 오류(%s) -> INVALID_INPUT', (date) => {
    expect(judge(makeInput({ date }))).toEqual(INVALID);
  });

  it.each([
    ['2026-02-30'],
    ['2026-13-01'],
    ['2026-11-31'],
  ])('달력에 없는 날짜(%s) -> INVALID_INPUT', (date) => {
    expect(judge(makeInput({ date }))).toEqual(INVALID);
  });

  it('시각 형식 오류(9:00, 24:00) -> INVALID_INPUT', () => {
    expect(judge(makeInput({ stayStart: '9:00', stayEnd: '17:00' }))).toEqual(INVALID);
    expect(judge(makeInput({ stayStart: '14:00', stayEnd: '24:00' }))).toEqual(INVALID);
  });

  it('머무는 끝이 시작과 같거나 이르면 -> INVALID_INPUT', () => {
    expect(judge(makeInput({ stayStart: '14:00', stayEnd: '14:00' }))).toEqual(INVALID);
    expect(judge(makeInput({ stayStart: '15:00', stayEnd: '14:00' }))).toEqual(INVALID);
  });

  it('입력 오류는 다른 사유보다 먼저 반환한다 (기간 밖이어도 INVALID_INPUT만)', () => {
    expect(judge(makeInput({ date: '2026-12-01', stayStart: '15:00', stayEnd: '14:00' }))).toEqual(INVALID);
  });
});

describe('judge 입장 마감', () => {
  // 2026-11-10은 화요일
  it('lastEntryByDay에 그 요일 값이 있으면 그 값을 쓴다', () => {
    const result = judge(
      makeResolvedInput(
        { lastEntry: '17:00', lastEntryByDay: { tue: '16:00' }, visitMinutes: 30 },
        { stayStart: '16:30', stayEnd: '18:00' },
      ),
    );
    expect(result.result).toBe('impossible');
    expect(result.reasons).toEqual([REASONS.AFTER_LAST_ENTRY('16:00')]);
  });

  it('lastEntryByDay에 그 요일 값이 없으면 lastEntry를 쓴다', () => {
    const result = judge(
      makeResolvedInput(
        { lastEntry: '17:00', lastEntryByDay: { mon: '16:00' }, visitMinutes: 30 },
        { stayStart: '16:30', stayEnd: '18:00' },
      ),
    );
    expect(result.result).toBe('possible');
    expect(result.entryTime).toBe('16:30');
  });

  it('lastEntry도 lastEntryByDay 값도 없으면 폐관 기준으로 판정하고 lastEntryAssumed', () => {
    const result = judge(makeResolvedInput({ lastEntry: undefined, lastEntryByDay: { mon: '16:00' } }));
    expect(result.result).toBe('possible');
    expect(result.reasons).toEqual([]);
    expect(result.lastEntryAssumed).toBe(true);
  });

  it('입장 마감(20:00)이 그날 폐관(18:00)보다 늦으면 폐관 시각으로 보정한다', () => {
    const result = judge(
      makeInput({ venue: { lastEntry: '20:00' }, stayStart: '18:30', stayEnd: '20:00' }),
    );
    expect(result.result).toBe('impossible');
    expect(result.reasons).toContain(REASONS.AFTER_LAST_ENTRY('18:00'));
    expect(result.reasons).toEqual([REASONS.AFTER_LAST_ENTRY('18:00'), REASONS.NOT_ENOUGH_BEFORE_CLOSE]);
  });
});

describe('judge basis', () => {
  it('venue.basis가 없으면 모든 결과에 basis: venue', () => {
    expect(judge(makeInput()).basis).toBe('venue'); // possible
    expect(judge(makeInput({ date: '2026-12-01' })).basis).toBe('venue'); // impossible
    expect(judge(makeInput({ venue: { hours: {} } })).basis).toBe('venue'); // unknown
  });

  it('ResolvedVenue의 basis를 그대로 내보낸다', () => {
    expect(judge(makeResolvedInput({ basis: 'merged' })).basis).toBe('merged');
    expect(judge(makeResolvedInput({ basis: 'exhibition' }, { date: '2026-12-01' })).basis).toBe('exhibition');
    expect(judge(makeResolvedInput({ basis: 'exhibition' }, { date: '2026-02-30' })).basis).toBe('exhibition');
  });
});

describe('judge 사유 문구', () => {
  it('공휴일 다음 날 대체 휴관은 새 문구로 나온다', () => {
    // 2026-11-09(월)이 공휴일이고 월요일 휴관 + nextDay -> 11-10(화) 대체 휴관
    const result = judge(
      makeInput({
        venue: { closed: { weekday: 'mon', ifHoliday: 'nextDay' } },
        holidays: ['2026-11-09'],
      }),
    );
    expect(result.result).toBe('impossible');
    expect(result.reasons).toEqual(['공휴일 다음 날이라 휴관입니다']);
    expect(result.reasons).toEqual([REASONS.CLOSED_HOLIDAY]);
  });
});

describe('judge 지정 휴관일(closed.dates)', () => {
  const EVERYDAY = { open: '10:00', close: '18:00' };
  const ALL_DAYS = { mon: EVERYDAY, tue: EVERYDAY, wed: EVERYDAY, thu: EVERYDAY, fri: EVERYDAY, sat: EVERYDAY, sun: EVERYDAY };
  // 전시 기간은 테스트 날짜를 모두 덮는다
  const LONG_EXHIBITION = { start: '2026-11-01', end: '2027-12-31' };

  it("'MM-DD'(01-01)는 매년 휴관 -> 2027-01-01 impossible, CLOSED_DATE", () => {
    const result = judge(
      makeInput({
        venue: { hours: ALL_DAYS, closed: { dates: ['01-01'] } },
        exhibition: LONG_EXHIBITION,
        date: '2027-01-01',
      }),
    );
    expect(result.result).toBe('impossible');
    expect(result.reasons).toContain(REASONS.CLOSED_DATE);
  });

  it("'YYYY-MM-DD'(2026-12-01)는 그해만 휴관 -> 2027-12-01은 CLOSED_DATE로 막히지 않음", () => {
    const venue = { hours: ALL_DAYS, closed: { dates: ['2026-12-01'] } };

    const thisYear = judge(makeInput({ venue, exhibition: LONG_EXHIBITION, date: '2026-12-01' }));
    expect(thisYear.result).toBe('impossible');
    expect(thisYear.reasons).toContain(REASONS.CLOSED_DATE);

    const nextYear = judge(makeInput({ venue, exhibition: LONG_EXHIBITION, date: '2027-12-01' }));
    expect(nextYear.reasons).not.toContain(REASONS.CLOSED_DATE);
    expect(nextYear.result).toBe('possible');
  });
});

describe('judge 입장 마감이 없을 때 폐관 시각 사용', () => {
  it('입장 마감이 데이터에 있으면 lastEntryAssumed를 넣지 않는다', () => {
    expect(judge(makeInput())).not.toHaveProperty('lastEntryAssumed');
    const byDay = judge(makeResolvedInput({ lastEntry: undefined, lastEntryByDay: { tue: '17:00' } }));
    expect(byDay.result).toBe('possible');
    expect(byDay).not.toHaveProperty('lastEntryAssumed');
  });

  it('폐관 기준이면 입장 마감 사유 없이 폐관 전 관람 시간 부족만 낸다 (불가에는 lastEntryAssumed 없음)', () => {
    const result = judge(
      makeInput({ venue: { lastEntry: undefined }, stayStart: '17:30', stayEnd: '19:00' }),
    );
    expect(result).toEqual({
      result: 'impossible',
      reasons: [REASONS.NOT_ENOUGH_BEFORE_CLOSE],
      basis: 'venue',
    });
    // 폐관 뒤 도착도 AFTER_LAST_ENTRY('18:00')를 내지 않는다
    const late = judge(makeInput({ venue: { lastEntry: undefined }, stayStart: '18:30', stayEnd: '20:00' }));
    expect(late.reasons).toEqual([REASONS.NOT_ENOUGH_BEFORE_CLOSE]);
  });

  it('폐관 정각에 관람이 끝나면 가능', () => {
    const result = judge(makeInput({ venue: { lastEntry: undefined }, stayStart: '17:00', stayEnd: '19:00' }));
    expect(result).toMatchObject({ result: 'possible', entryTime: '17:00', endTime: '18:00', slackMinutes: 0 });
  });

  it('입장 마감 값이 있는데 형식이 틀리면 지금처럼 MISSING_LAST_ENTRY', () => {
    const result = judge(makeInput({ venue: { lastEntry: '5pm' } }));
    expect(result).toEqual({ result: 'unknown', reasons: [REASONS.MISSING_LAST_ENTRY], basis: 'venue' });
  });
});

describe('judge 구간이 여러 개인 날 (intervalsByDay)', () => {
  // 화요일 10:00~12:00 / 13:00~18:00(입장 마감 17:00). 점심 휴관
  const LUNCH = {
    lastEntry: undefined,
    hours: { tue: { open: '10:00', close: '18:00' } },
    intervalsByDay: {
      tue: [
        { open: '10:00', close: '12:00' },
        { open: '13:00', close: '18:00', lastEntry: '17:00' },
      ],
    },
    visitMinutes: 60,
  };

  it('오전 구간에서 마칠 수 있으면 오전 구간 (입장 마감 없음 → lastEntryAssumed)', () => {
    const result = judge(makeResolvedInput(LUNCH, { stayStart: '10:00', stayEnd: '12:00' }));
    expect(result).toEqual({
      result: 'possible',
      reasons: [],
      entryTime: '10:00',
      endTime: '11:00',
      slackMinutes: 60,
      basis: 'venue',
      lastEntryAssumed: true,
    });
  });

  it('오전 구간에 안 들어가면 오후 구간 시작에 입장', () => {
    const result = judge(makeResolvedInput(LUNCH, { stayStart: '11:30', stayEnd: '14:30' }));
    expect(result).toEqual({
      result: 'possible',
      reasons: [],
      entryTime: '13:00',
      endTime: '14:00',
      slackMinutes: 30,
      basis: 'venue',
    });
  });

  it('모두 안 되면 가장 가까웠던 구간의 사유 (오전: 30분 모자람, 오후: 75분 모자람)', () => {
    const result = judge(makeResolvedInput(LUNCH, { stayStart: '11:30', stayEnd: '12:45' }));
    expect(result).toEqual({
      result: 'impossible',
      reasons: [REASONS.NOT_ENOUGH_BEFORE_CLOSE],
      basis: 'venue',
    });
  });

  it('늦게 오면 오후 구간 기준 사유 (입장 마감 17:00)', () => {
    const result = judge(makeResolvedInput(LUNCH, { stayStart: '17:30', stayEnd: '19:00' }));
    expect(result).toEqual({
      result: 'impossible',
      reasons: [REASONS.AFTER_LAST_ENTRY('17:00'), REASONS.NOT_ENOUGH_BEFORE_CLOSE],
      basis: 'venue',
    });
  });

  it('구간에 입장 마감이 없으면 시설 lastEntry를 그 구간 끝까지로 줄여 쓴다', () => {
    const result = judge(
      makeResolvedInput({ ...LUNCH, lastEntry: '17:00' }, { stayStart: '11:30', stayEnd: '12:45' }),
    );
    expect(result.reasons).toEqual([REASONS.NOT_ENOUGH_BEFORE_CLOSE]);
    expect(result).not.toHaveProperty('lastEntryAssumed');
  });

  it('휴관 규칙은 구간보다 먼저 본다', () => {
    const result = judge(makeResolvedInput({ ...LUNCH, closed: { dates: ['2026-11-10'] } }));
    expect(result.reasons).toEqual([REASONS.CLOSED_DATE]);
  });

  it('구간 시각 형식이 틀리면 MISSING_HOURS', () => {
    const result = judge(
      makeResolvedInput({ ...LUNCH, intervalsByDay: { tue: [{ open: '9:00', close: '12:00' }, { open: '13:00', close: '18:00' }] } }),
    );
    expect(result).toEqual({ result: 'unknown', reasons: [REASONS.MISSING_HOURS], basis: 'venue' });
  });

  it('다른 요일에만 intervalsByDay가 있으면 hours 하나로 판정 (지금과 같음)', () => {
    const result = judge(
      makeResolvedInput({ intervalsByDay: { mon: [{ open: '10:00', close: '11:00' }, { open: '12:00', close: '13:00' }] } }),
    );
    expect(result).toEqual(judge(makeInput()));
  });
});

describe('judge 입장 마감 = 폐관 − N분 (lastEntryBeforeClose)', () => {
  // 화요일 10:00~20:00, 관람 60분
  const LATE = { hours: { tue: { open: '10:00', close: '20:00' } }, lastEntry: undefined, lastEntryBeforeClose: 60 };

  it('폐관 20:00 − 60분 = 19:00 정각 도착은 가능 (lastEntryAssumed 없음)', () => {
    const result = judge(makeInput({ venue: LATE, stayStart: '19:00', stayEnd: '21:00' }));
    expect(result).toEqual({
      result: 'possible',
      reasons: [],
      entryTime: '19:00',
      endTime: '20:00',
      slackMinutes: 0,
      basis: 'venue',
    });
  });

  it('19:01 도착은 불가, AFTER_LAST_ENTRY(19:00)', () => {
    const result = judge(makeInput({ venue: LATE, stayStart: '19:01', stayEnd: '21:00' }));
    expect(result.result).toBe('impossible');
    expect(result.reasons).toEqual([REASONS.AFTER_LAST_ENTRY('19:00'), REASONS.NOT_ENOUGH_BEFORE_CLOSE]);
  });

  it('우선순위: lastEntryBeforeClose > lastEntry', () => {
    // lastEntry 17:00만 보면 18:30은 불가지만 폐관 − 60 = 19:00이 이긴다
    const result = judge(makeInput({ venue: { ...LATE, lastEntry: '17:00' }, stayStart: '18:30', stayEnd: '21:00' }));
    expect(result).toMatchObject({ result: 'possible', entryTime: '18:30' });
  });

  it('우선순위: lastEntryByDay(전시 근거) > lastEntryBeforeClose', () => {
    const venue: ResolvedVenue = { ...makeVenue(LATE), lastEntryByDay: { tue: '18:00' } };
    const result = judge({ ...makeInput({ stayStart: '18:30', stayEnd: '21:00' }), venue });
    expect(result.reasons).toEqual([REASONS.AFTER_LAST_ENTRY('18:00')]);
  });

  it('폐관 − N이 개관보다 이르면 그대로 계산해 불가', () => {
    const result = judge(
      makeInput({
        venue: { hours: { tue: { open: '10:00', close: '11:00' } }, lastEntryBeforeClose: 120 },
        stayStart: '10:00',
        stayEnd: '12:00',
      }),
    );
    expect(result.result).toBe('impossible');
    expect(result.reasons).toEqual([REASONS.AFTER_LAST_ENTRY('09:00')]);
  });

  it('N이 음수면 MISSING_LAST_ENTRY(확인 필요)', () => {
    const result = judge(makeInput({ venue: { ...LATE, lastEntryBeforeClose: -10 }, stayStart: '14:00', stayEnd: '17:00' }));
    expect(result).toEqual({ result: 'unknown', reasons: [REASONS.MISSING_LAST_ENTRY], basis: 'venue' });
  });

  it('구간이 여러 개인 날: 구간에 입장 마감이 없으면 그날 폐관 − N을 쓴다', () => {
    const venue: ResolvedVenue = {
      ...makeVenue({ hours: { tue: { open: '10:00', close: '18:00' } }, lastEntry: undefined, lastEntryBeforeClose: 60 }),
      intervalsByDay: { tue: [{ open: '10:00', close: '12:00' }, { open: '13:00', close: '18:00' }] },
    };
    const result = judge({ ...makeInput({ stayStart: '17:01', stayEnd: '19:00' }), venue });
    expect(result.reasons).toEqual([REASONS.AFTER_LAST_ENTRY('17:00'), REASONS.NOT_ENOUGH_BEFORE_CLOSE]);
  });
});

describe('judge 공휴일 운영시간 (holidayAs)', () => {
  // 화 10:00~20:00, 일 10:00~18:00, 입장 마감 폐관 − 60분. 2026-11-10(화)을 공휴일로 둔다
  const HOLIDAY_VENUE = {
    hours: { tue: { open: '10:00', close: '20:00' }, sun: { open: '10:00', close: '18:00' } },
    holidayAs: 'sun' as const,
    lastEntry: undefined,
    lastEntryBeforeClose: 60,
  };

  it('공휴일이면 일요일 시간·입장 마감(17:00)으로 판정', () => {
    const result = judge(makeInput({ venue: HOLIDAY_VENUE, stayStart: '17:30', stayEnd: '20:00', holidays: ['2026-11-10'] }));
    expect(result.reasons).toEqual([REASONS.AFTER_LAST_ENTRY('17:00'), REASONS.NOT_ENOUGH_BEFORE_CLOSE]);
  });

  it('공휴일이 아니면 화요일 시간 그대로', () => {
    const result = judge(makeInput({ venue: HOLIDAY_VENUE, stayStart: '17:30', stayEnd: '20:00' }));
    expect(result).toMatchObject({ result: 'possible', entryTime: '17:30', endTime: '18:30' });
  });

  it('holidayAs 요일의 hours가 없으면 MISSING_HOURS(확인 필요)', () => {
    const result = judge(
      makeInput({ venue: { ...HOLIDAY_VENUE, hours: { tue: { open: '10:00', close: '20:00' } } }, holidays: ['2026-11-10'] }),
    );
    expect(result).toEqual({ result: 'unknown', reasons: [REASONS.MISSING_HOURS], basis: 'venue' });
  });
});
