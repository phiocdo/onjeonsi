/**
 * 기능명세서 F-05 판정 시나리오.
 * 인수 기준: "테스트 케이스 20건이 모두 통과한다: 평일 정상 운영, 휴관 요일, 공휴일과 겹친 휴관 요일,
 * 고정 휴관일, 임시 휴관, 입장 마감 정각·1분 뒤, 폐관 정각·1분 초과, 머물 시간 경계, 운영 시간 없음,
 * 입장 마감 없음. 어긴 조건이 있으면 정보가 비어 있어도 불가가 나온다."
 *
 * 실제 data 파일은 읽지 않는다. 데이터가 바뀌어도 흔들리지 않도록 시설·전시·공휴일을 여기 고정한다.
 * 각 시나리오는 조건 하나만 어기도록 시설·시각을 골라 사유가 정확히 하나 나오게 한다
 * (S19 여러 조건 동시 위반은 예외).
 *
 * 달력 (2026-11): 16 월, 17 화, 18 수, 21 토, 23 월, 24 화
 */
import { describe, it, expect } from 'vitest';
import type { Exhibition, JudgeInput, Venue } from '../types';
import { judge, type ResolvedVenue } from './judge';
import { judgeResolved, resolveSchedule } from './resolveSchedule';
import { REASONS } from './reasons';

const OPEN_10_18 = { open: '10:00', close: '18:00' };

/**
 * 기준 시설: 화~일 10:00~18:00, 월 휴관(공휴일이면 다음 날 휴관),
 * 입장 마감 17:00, 고정 휴관 1/1, 임시 휴관 2026-12-01, 관람 60분.
 * 월요일 공휴일에는 문을 열므로 hours.mon도 있다.
 */
const BASE_VENUE: Venue = {
  id: 'scenario-venue',
  name: '시나리오 미술관',
  aliases: [],
  gu: '종로구',
  type: '미술관',
  lat: 37.58,
  lng: 126.98,
  representative: false,
  hours: {
    mon: OPEN_10_18,
    tue: OPEN_10_18,
    wed: OPEN_10_18,
    thu: OPEN_10_18,
    fri: OPEN_10_18,
    sat: OPEN_10_18,
    sun: OPEN_10_18,
  },
  closed: { weekday: 'mon', ifHoliday: 'nextDay', dates: ['01-01', '2026-12-01'] },
  lastEntry: '17:00',
  visitMinutes: 60,
  source: 'scenario-test',
  verified: '2026-11-17',
};

const BASE_EXHIBITION: Exhibition = {
  id: 'scenario-exhibition',
  venueId: 'scenario-venue',
  title: '시나리오 전시',
  start: '2026-11-01',
  end: '2027-01-31',
};

/** 테스트용 가상 공휴일. 실제 공휴일이 아니다(월요일 공휴일 처리를 보려고 넣었다). */
const HOLIDAYS = ['2026-11-23'];

/** 기준 시설에서 일부만 바꾼 시설. */
function venueWith(overrides: Partial<Venue>): Venue {
  return { ...BASE_VENUE, ...overrides };
}

interface Case {
  venue?: Venue;
  exhibition?: Exhibition;
  date: string;
  stayStart: string;
  stayEnd: string;
  holidays?: string[];
}

function input(c: Case): JudgeInput {
  return {
    venue: c.venue ?? BASE_VENUE,
    exhibition: c.exhibition ?? BASE_EXHIBITION,
    date: c.date,
    stayStart: c.stayStart,
    stayEnd: c.stayEnd,
    holidays: c.holidays ?? HOLIDAYS,
  };
}

function run(c: Case) {
  return judge(input(c));
}

const WED = '2026-11-18';

describe('F-05 판정 시나리오', () => {
  it('S01 평일 정상 운영: 수요일 13:00~16:00 → 가능', () => {
    expect(run({ date: WED, stayStart: '13:00', stayEnd: '16:00' })).toEqual({
      result: 'possible',
      reasons: [],
      entryTime: '13:00',
      endTime: '14:00',
      slackMinutes: 120,
      basis: 'venue',
    });
  });

  it('S02 개관 전 도착: 09:00 도착 → 개관 시각 10:00 입장', () => {
    expect(run({ date: WED, stayStart: '09:00', stayEnd: '12:00' })).toEqual({
      result: 'possible',
      reasons: [],
      entryTime: '10:00',
      endTime: '11:00',
      slackMinutes: 60,
      basis: 'venue',
    });
  });

  it('S03 휴관 요일: 평범한 월요일 → 불가, CLOSED_WEEKDAY', () => {
    expect(run({ date: '2026-11-16', stayStart: '13:00', stayEnd: '16:00' })).toEqual({
      result: 'impossible',
      reasons: [REASONS.CLOSED_WEEKDAY('월')],
      basis: 'venue',
    });
  });

  it('S04 공휴일과 겹친 휴관 요일: 월요일 공휴일 → 개관, 가능', () => {
    expect(run({ date: '2026-11-23', stayStart: '13:00', stayEnd: '16:00' })).toEqual({
      result: 'possible',
      reasons: [],
      entryTime: '13:00',
      endTime: '14:00',
      slackMinutes: 120,
      basis: 'venue',
    });
  });

  it('S05 공휴일과 겹친 휴관 요일의 다음 날(대체 휴관): 화요일 → 불가, CLOSED_HOLIDAY', () => {
    expect(run({ date: '2026-11-24', stayStart: '13:00', stayEnd: '16:00' })).toEqual({
      result: 'impossible',
      reasons: [REASONS.CLOSED_HOLIDAY],
      basis: 'venue',
    });
  });

  it('S06 고정 휴관일(MM-DD): 2027-01-01 → 불가, CLOSED_DATE', () => {
    // 2027-01-01은 금요일, 전시 기간 안이고 HOLIDAYS에는 없다
    expect(run({ date: '2027-01-01', stayStart: '13:00', stayEnd: '16:00' })).toEqual({
      result: 'impossible',
      reasons: [REASONS.CLOSED_DATE],
      basis: 'venue',
    });
  });

  it('S07 임시 휴관(YYYY-MM-DD): 2026-12-01 → 불가, CLOSED_DATE. 다음 해 같은 날은 막히지 않음', () => {
    expect(run({ date: '2026-12-01', stayStart: '13:00', stayEnd: '16:00' })).toEqual({
      result: 'impossible',
      reasons: [REASONS.CLOSED_DATE],
      basis: 'venue',
    });
    // 2027-12-01(수)은 기준 전시 기간 밖이라 기간만 늘린 전시로 본다
    const longer = { ...BASE_EXHIBITION, end: '2027-12-31' };
    expect(run({ exhibition: longer, date: '2027-12-01', stayStart: '13:00', stayEnd: '16:00' })).toMatchObject({
      result: 'possible',
      reasons: [],
    });
  });

  it('S08 입장 마감 정각 도착: 17:00 도착 → 가능', () => {
    // 17:00 입장 + 60분 = 18:00 폐관 정각이라 폐관 조건도 통과한다
    expect(run({ date: WED, stayStart: '17:00', stayEnd: '19:00' })).toEqual({
      result: 'possible',
      reasons: [],
      entryTime: '17:00',
      endTime: '18:00',
      slackMinutes: 0,
      basis: 'venue',
    });
  });

  it('S09 입장 마감 1분 뒤 도착: 17:01 도착 → 불가, AFTER_LAST_ENTRY 하나만', () => {
    // 폐관을 20:00으로 늦춰 폐관 조건은 걸리지 않게 한다
    const lateClose = venueWith({ hours: { ...BASE_VENUE.hours, wed: { open: '10:00', close: '20:00' } } });
    expect(run({ venue: lateClose, date: WED, stayStart: '17:01', stayEnd: '19:00' })).toEqual({
      result: 'impossible',
      reasons: [REASONS.AFTER_LAST_ENTRY('17:00')],
      basis: 'venue',
    });
  });

  it('S10 폐관 정각에 관람 종료: 관람 90분, 16:30 도착 → 18:00 종료, 가능, 여유 0', () => {
    // 입장 마감 경계와 섞이지 않게 관람 시간을 90분으로 둔다
    const long = venueWith({ visitMinutes: 90 });
    expect(run({ venue: long, date: WED, stayStart: '16:30', stayEnd: '19:00' })).toEqual({
      result: 'possible',
      reasons: [],
      entryTime: '16:30',
      endTime: '18:00',
      slackMinutes: 0,
      basis: 'venue',
    });
  });

  it('S11 폐관 1분 초과: 관람 90분, 16:31 도착 → 불가, NOT_ENOUGH_BEFORE_CLOSE 하나만', () => {
    const long = venueWith({ visitMinutes: 90 });
    expect(run({ venue: long, date: WED, stayStart: '16:31', stayEnd: '19:00' })).toEqual({
      result: 'impossible',
      reasons: [REASONS.NOT_ENOUGH_BEFORE_CLOSE],
      basis: 'venue',
    });
  });

  it('S12 머물 시간 경계: 머물 시간 끝 정각에 종료 → 가능', () => {
    expect(run({ date: WED, stayStart: '13:00', stayEnd: '14:00' })).toEqual({
      result: 'possible',
      reasons: [],
      entryTime: '13:00',
      endTime: '14:00',
      slackMinutes: 0,
      basis: 'venue',
    });
  });

  it('S13 머물 시간 경계: 1분 부족 → 불가, NOT_ENOUGH_STAY 하나만', () => {
    expect(run({ date: WED, stayStart: '13:00', stayEnd: '13:59' })).toEqual({
      result: 'impossible',
      reasons: [REASONS.NOT_ENOUGH_STAY],
      basis: 'venue',
    });
  });

  it('S14 운영 시간 없음: 휴관 요일도 아닌데 수요일 hours 없음 → 확인 필요, MISSING_HOURS', () => {
    const { wed: _wed, ...noWed } = BASE_VENUE.hours!;
    void _wed;
    expect(run({ venue: venueWith({ hours: noWed }), date: WED, stayStart: '13:00', stayEnd: '16:00' })).toEqual({
      result: 'unknown',
      reasons: [REASONS.MISSING_HOURS],
      basis: 'venue',
    });
  });

  it('S15 입장 마감 없음: 폐관 기준으로 판정 → 가능 + lastEntryAssumed', () => {
    const noLastEntry = venueWith({ lastEntry: undefined });
    expect(run({ venue: noLastEntry, date: WED, stayStart: '17:00', stayEnd: '19:00' })).toEqual({
      result: 'possible',
      reasons: [],
      entryTime: '17:00',
      endTime: '18:00',
      slackMinutes: 0,
      basis: 'venue',
      lastEntryAssumed: true,
    });
    // 폐관 기준에서 늦으면 폐관 사유 하나만, AFTER_LAST_ENTRY와 lastEntryAssumed는 없다
    expect(run({ venue: noLastEntry, date: WED, stayStart: '17:01', stayEnd: '19:00' })).toEqual({
      result: 'impossible',
      reasons: [REASONS.NOT_ENOUGH_BEFORE_CLOSE],
      basis: 'venue',
    });
  });

  it('S16 입장 마감 형식 오류: lastEntry "5pm" → 확인 필요, MISSING_LAST_ENTRY', () => {
    const badLastEntry = venueWith({ lastEntry: '5pm' });
    expect(run({ venue: badLastEntry, date: WED, stayStart: '13:00', stayEnd: '16:00' })).toEqual({
      result: 'unknown',
      reasons: [REASONS.MISSING_LAST_ENTRY],
      basis: 'venue',
    });
  });

  it('S17 어긴 조건 + 정보 없음: 기간 밖 + 운영 시간 없음 → 불가, 정보 없음 사유는 버림', () => {
    const { wed: _wed, ...noWed } = BASE_VENUE.hours!;
    void _wed;
    // 2026-10-28은 수요일, 전시 시작(11-01) 전
    expect(
      run({ venue: venueWith({ hours: noWed }), date: '2026-10-28', stayStart: '13:00', stayEnd: '16:00' }),
    ).toEqual({
      result: 'impossible',
      reasons: [REASONS.OUT_OF_PERIOD],
      basis: 'venue',
    });
    // 입장 마감 형식 오류 + 머물 시간 부족도 같은 규칙: 불가, MISSING_LAST_ENTRY는 버림
    expect(
      run({ venue: venueWith({ lastEntry: '5pm' }), date: WED, stayStart: '13:00', stayEnd: '13:59' }),
    ).toEqual({
      result: 'impossible',
      reasons: [REASONS.NOT_ENOUGH_STAY],
      basis: 'venue',
    });
  });

  it('S18 전시 기간 밖: 전시 시작 전 수요일 → 불가, OUT_OF_PERIOD', () => {
    expect(run({ date: '2026-10-28', stayStart: '13:00', stayEnd: '16:00' })).toEqual({
      result: 'impossible',
      reasons: [REASONS.OUT_OF_PERIOD],
      basis: 'venue',
    });
    // 전시 종료 뒤. 끝난 다음 날 2027-02-01은 월요일(휴관)이라 2027-02-02(화)로 본다
    expect(run({ date: '2027-02-02', stayStart: '13:00', stayEnd: '16:00' })).toEqual({
      result: 'impossible',
      reasons: [REASONS.OUT_OF_PERIOD],
      basis: 'venue',
    });
  });

  it('S19 여러 조건 동시 위반 → 불가, 사유를 모두 적음', () => {
    // 기간 밖 + 입장 마감 이후 + 폐관 전 부족 + 머물 시간 부족
    expect(run({ date: '2026-10-28', stayStart: '17:30', stayEnd: '18:00' })).toEqual({
      result: 'impossible',
      reasons: [
        REASONS.OUT_OF_PERIOD,
        REASONS.AFTER_LAST_ENTRY('17:00'),
        REASONS.NOT_ENOUGH_BEFORE_CLOSE,
        REASONS.NOT_ENOUGH_STAY,
      ],
      basis: 'venue',
    });
    // 기간 밖 + 휴관 요일 (휴관이면 시간 조건은 보지 않는다)
    expect(run({ date: '2026-10-26', stayStart: '17:30', stayEnd: '18:00' })).toEqual({
      result: 'impossible',
      reasons: [REASONS.OUT_OF_PERIOD, REASONS.CLOSED_WEEKDAY('월')],
      basis: 'venue',
    });
  });

  it('S20 잘못된 입력 → 확인 필요, INVALID_INPUT 하나만', () => {
    const invalid = { result: 'unknown', reasons: [REASONS.INVALID_INPUT], basis: 'venue' };
    // stayEnd == stayStart
    expect(run({ date: WED, stayStart: '13:00', stayEnd: '13:00' })).toEqual(invalid);
    // stayEnd < stayStart
    expect(run({ date: WED, stayStart: '15:00', stayEnd: '13:00' })).toEqual(invalid);
    // 없는 날짜
    expect(run({ date: '2026-02-30', stayStart: '13:00', stayEnd: '16:00' })).toEqual(invalid);
    // 다른 위반(기간 밖 + 휴관 요일)이 있어도 입력 오류 하나만
    expect(run({ date: '2026-10-26', stayStart: '15:00', stayEnd: '13:00' })).toEqual(invalid);
  });

  describe('추가: 점심 휴관(구간 여러 개)', () => {
    // 수요일 10:00~12:00 / 13:00~18:00, 입장 마감 17:00
    const lunch: ResolvedVenue = {
      ...BASE_VENUE,
      intervalsByDay: {
        wed: [
          { open: '10:00', close: '12:00' },
          { open: '13:00', close: '18:00' },
        ],
      },
    };

    it('S21 점심 휴관: 11:30~14:30 → 오후 구간 13:00 입장, 가능', () => {
      expect(run({ venue: lunch, date: WED, stayStart: '11:30', stayEnd: '14:30' })).toEqual({
        result: 'possible',
        reasons: [],
        entryTime: '13:00',
        endTime: '14:00',
        slackMinutes: 30,
        basis: 'venue',
      });
    });

    it('S22 점심 휴관: 11:30~12:45 → 불가, 가장 가까운 오전 구간 사유 NOT_ENOUGH_BEFORE_CLOSE 하나만', () => {
      expect(run({ venue: lunch, date: WED, stayStart: '11:30', stayEnd: '12:45' })).toEqual({
        result: 'impossible',
        reasons: [REASONS.NOT_ENOUGH_BEFORE_CLOSE],
        basis: 'venue',
      });
    });
  });

  it('S23 시설 없음(judgeResolved) → 확인 필요, MISSING_VENUE', () => {
    const { venue: _v, ...rest } = input({ date: WED, stayStart: '13:00', stayEnd: '16:00' });
    void _v;
    expect(judgeResolved(rest, resolveSchedule(null, undefined))).toEqual({
      result: 'unknown',
      reasons: [REASONS.MISSING_VENUE],
    });
    expect(judgeResolved(rest, resolveSchedule(null, undefined, { useExhibitionHours: true }))).toEqual({
      result: 'unknown',
      reasons: [REASONS.MISSING_VENUE],
    });
  });
});
