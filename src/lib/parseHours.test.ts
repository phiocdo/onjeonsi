import { describe, it, expect } from 'vitest';
import { parseHours } from './parseHours';
import type { Weekday } from '../types';

const ORDER: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** 문 여는 요일만 돌려준다 */
const openDays = (text: string, year = 2026) => {
  const r = parseHours(text, year);
  return ORDER.filter(d => r.weekdays[d].isOpen);
};
/** 그 요일의 첫 구간을 'open-close' 로 돌려준다 */
const span = (text: string, day: Weekday, year = 2026) => {
  const i = parseHours(text, year).weekdays[day].intervals[0];
  return i ? `${i.open}-${i.close}` : null;
};

describe('parseHours — 단순한 문구', () => {
  it('시간만 적혀 있으면 7일 모두 그 시간으로 연다', () => {
    expect(openDays('10:00~18:00')).toEqual(ORDER);
    expect(span('10:00~18:00', 'mon')).toBe('10:00-18:00');
  });

  it('한 자리 시각을 두 자리로 맞춘다', () => {
    expect(span('9:00~18:00', 'mon')).toBe('09:00-18:00');
  });

  it('한글 시간 표기도 읽는다', () => {
    expect(span('10시-18시', 'mon')).toBe('10:00-18:00');
  });

  it('구분자가 물결이든 하이픈이든 공백이 있어도 읽는다', () => {
    expect(span('13:00 ~ 18:00', 'mon')).toBe('13:00-18:00');
    expect(span('10:00-18:00', 'mon')).toBe('10:00-18:00');
  });
});

describe('parseHours — 요일 지정', () => {
  it('요일 범위를 펼친다', () => {
    expect(openDays('화-일요일 10:00~18:00')).toEqual(['tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
  });

  it('범위에 없는 요일은 휴관으로 둔다', () => {
    expect(openDays('화-토요일 11:00~18:00')).toEqual(['tue', 'wed', 'thu', 'fri', 'sat']);
  });

  it('평일과 주말을 구분한다', () => {
    expect(span('평일 11:00~19:00 / 토,일 12:00~18:00', 'mon')).toBe('11:00-19:00');
    expect(span('평일 11:00~19:00 / 토,일 12:00~18:00', 'sat')).toBe('12:00-18:00');
    expect(span('평일 11:00~19:00 / 토,일 12:00~18:00', 'sun')).toBe('12:00-18:00');
  });

  it('구간이 여러 개면 각 구간의 요일에 따로 넣는다', () => {
    const t = '화-금요일 13:00~19:00, 토,일요일 및 공휴일 13:00~18:00';
    expect(span(t, 'tue')).toBe('13:00-19:00');
    expect(span(t, 'sat')).toBe('13:00-18:00');
    expect(openDays(t)).not.toContain('mon');
  });

  it('월-금 / 토 따로 적힌 것도 나눈다', () => {
    const t = '월-금 11:00~18:00, 토 11:00~17:00 (일휴무)';
    expect(span(t, 'mon')).toBe('11:00-18:00');
    expect(span(t, 'sat')).toBe('11:00-17:00');
    expect(openDays(t)).not.toContain('sun');
  });
});

describe('parseHours — 휴관', () => {
  it('괄호 안 휴관 요일을 닫는다', () => {
    const t = '화-토, 오전10:00~18:00 (일, 월, 공휴일 휴관)';
    expect(openDays(t)).toEqual(['tue', 'wed', 'thu', 'fri', 'sat']);
    expect(parseHours(t, 2026).holiday).toEqual({ isOpen: false, intervals: [] });
  });

  it('시간 뒤에 적힌 휴관 요일을 닫는다', () => {
    expect(openDays('10:00~18:00, 일,월 휴관')).toEqual(['tue', 'wed', 'thu', 'fri', 'sat']);
    expect(openDays('11:00~18:00, 월요일 휴관')).not.toContain('mon');
  });

  it('운영시간 설명에 들어 있는 요일을 휴관으로 오인하지 않는다', () => {
    // "화-일 10:00~18:00" 의 화, 일이 닫히면 안 된다
    const t = '화-일 10:00~18:00 ※ 월 휴관, 금 21:00 까지 야간개관';
    expect(openDays(t)).toContain('tue');
    expect(openDays(t)).toContain('sun');
    expect(openDays(t)).not.toContain('mon');
  });

  it('음력 명절 휴관은 공휴일 휴관으로 본다', () => {
    expect(parseHours('10:00~17:30, 매주 월요일 및 추석 당일 휴관', 2026).holiday)
      .toEqual({ isOpen: false, intervals: [] });
  });

  it('공휴일 언급이 없으면 holiday는 null이다', () => {
    expect(parseHours('10:00~18:00', 2026).holiday).toBeNull();
  });
});

describe('parseHours — 입장 마감', () => {
  it('괄호 안에 적힌 마감 시각을 읽는다', () => {
    expect(parseHours('9:00~18:00(입장마감 17:30)', 2026).weekdays.mon.intervals[0].lastAdmission)
      .toBe('17:30');
  });

  it('시각이 마감이라는 말보다 앞에 와도 읽는다', () => {
    expect(parseHours('9:00~17:30 (17:00 창덕궁 입장 마감)', 2026).weekdays.mon.intervals[0].lastAdmission)
      .toBe('17:00');
  });

  it('"종료 30분 전"은 폐관 시각에서 빼서 계산한다', () => {
    expect(parseHours('10시-18시 (종료 30분 전 입장마감)', 2026).weekdays.mon.intervals[0].lastAdmission)
      .toBe('17:30');
  });
});

describe('parseHours — 연장 운영', () => {
  it('특정 요일만 늦게 닫는다', () => {
    const t = '10:00~18:00 (평일, 주말 동일) 매주 금요일 21:00까지';
    expect(span(t, 'thu')).toBe('10:00-18:00');
    expect(span(t, 'fri')).toBe('10:00-21:00');
  });
});

describe('parseHours — 특정 날짜 예외', () => {
  it('날짜가 적힌 일정은 exceptions로 뺀다', () => {
    const r = parseHours('화-일요일 10:00~18:00 / 11.17(화) 오픈식 14:00~16:00', 2026);
    expect(r.exceptions).toEqual([
      { date: '2026-11-17', schedule: { isOpen: true, intervals: [{ open: '14:00', close: '16:00' }] } },
    ]);
  });

  it('연도가 적혀 있으면 그 연도를 쓴다', () => {
    const r = parseHours('11:00~18:00, 매주 월요일 정기휴관 *2026.9.2(수) 휴관', 2026);
    expect(r.exceptions[0]).toEqual({
      date: '2026-09-02',
      schedule: { isOpen: false, intervals: [] },
    });
  });
});

describe('parseHours — 상시와 판별 불가', () => {
  it('상시 운영은 always_open 으로 둔다', () => {
    const r = parseHours('월-일요일 0:00~24:00', 2026);
    expect(r.scheduleType).toBe('always_open');
    // 24:00 은 판정 쪽 toMinutes 가 거부하므로 23:59 로 둔다
    expect(r.weekdays.mon.intervals[0]).toEqual({ open: '00:00', close: '23:59' });
  });

  it('연중무휴만 적힌 것도 상시로 본다', () => {
    expect(parseHours('연중무휴', 2026).scheduleType).toBe('always_open');
  });

  it('시각이 없는 문구는 unknown 으로 둔다', () => {
    expect(parseHours('프로그램별 상이', 2026).scheduleType).toBe('unknown');
    expect(parseHours('기관별 상이', 2026).scheduleType).toBe('unknown');
    expect(parseHours('전시3동  1층 쇼윈도 갤러리', 2026).scheduleType).toBe('unknown');
    expect(parseHours('', 2026).scheduleType).toBe('unknown');
  });

  it('회차만 적힌 문구는 끝 시각을 알 수 없어 unknown 으로 둔다', () => {
    expect(parseHours('12:00, 14:00, 16:00', 2026).scheduleType).toBe('unknown');
    expect(parseHours('1회차: 11:00(영문), 2회차: 13:00(국문)', 2026).scheduleType).toBe('unknown');
  });

  it('unknown 은 모든 요일을 닫아 두어 "가능"이 나오지 않게 한다', () => {
    expect(openDays('프로그램별 상이')).toEqual([]);
  });
});
