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

  it('"종료" 없이 "30분전 입장마감"으로만 적힌 것도 읽는다', () => {
    expect(parseHours('10:00-18:30(30분전 입장마감) / 매주 월요일 휴관', 2026).weekdays.tue.intervals[0].lastAdmission)
      .toBe('18:00');
  });

  it('분이 아니라 시간으로 적힌 것도 읽는다', () => {
    expect(parseHours('10:00~19:00(관람 종료 1시간 전 입장 마감)', 2026).weekdays.mon.intervals[0].lastAdmission)
      .toBe('18:00');
  });

  it('입장 대신 매표·발권으로 적힌 것도 읽는다', () => {
    expect(parseHours('10:00~19:00 (매표마감 18:00) *매주 월요일 휴관', 2026).weekdays.tue.intervals[0].lastAdmission)
      .toBe('18:00');
  });

  it('괄호가 말과 시각 사이에 끼어도 읽는다', () => {
    expect(parseHours('10:00~20:00 | (입장마감) 19:00', 2026).weekdays.mon.intervals[0].lastAdmission)
      .toBe('19:00');
  });

  it('"전시 종료일은 오후 4시 마감"은 입장 마감이 아니므로 넣지 않는다', () => {
    // 마지막 날만 일찍 닫는다는 뜻이라 매일의 입장 마감으로 쓰면 안 된다
    expect(parseHours('오전 10시 ~ 오후 6시 (전시 종료일은 오후 4시 마감 예정)', 2026).weekdays.mon.intervals[0].lastAdmission)
      .toBeUndefined();
  });
});

describe('parseHours — 오전·오후', () => {
  it('오후를 24시간제로 바꾼다', () => {
    expect(span('오전 10시 ~ 오후 6시', 'mon')).toBe('10:00-18:00');
    expect(span('오전 10시 ~ 오후 5시', 'mon')).toBe('10:00-17:00');
  });

  it('분이 붙어도 읽는다', () => {
    expect(span('오전 10시 - 오후 6시 30분', 'mon')).toBe('10:00-18:30');
  });

  it('오전/오후가 앞에만 붙으면 뒤 시각에도 적용한다', () => {
    // "오후 2시~3시" 은 14:00~15:00 이다. 뒤를 03:00 으로 읽으면 구간이 뒤집힌다
    expect(span('오후 2시~3시', 'mon')).toBe('14:00-15:00');
  });

  it('오전 12시는 자정, 오후 12시는 정오로 둔다', () => {
    expect(span('오전 12시~오전 6시', 'mon')).toBe('00:00-06:00');
    expect(span('오후 12시~오후 6시', 'mon')).toBe('12:00-18:00');
  });

  it('HH:MM 앞에 붙은 오후도 읽는다', () => {
    expect(span('오후 2:00~오후 7:00', 'mon')).toBe('14:00-19:00');
  });
});

describe('parseHours — 회차가 여러 개인 경우', () => {
  it('회차마다 구간을 따로 넣는다', () => {
    const r = parseHours('1회차14:00-15:20 / 2회차16:00-17:20', 2026);
    expect(r.weekdays.mon.intervals).toEqual([
      { open: '14:00', close: '15:20' },
      { open: '16:00', close: '17:20' },
    ]);
  });

  it('오전반·오후반도 구간 둘로 넣는다', () => {
    const r = parseHours('오전반(10:30~12:00), 오후반(13:30~15:00)', 2026);
    expect(r.weekdays.mon.intervals).toEqual([
      { open: '10:30', close: '12:00' },
      { open: '13:30', close: '15:00' },
    ]);
  });

  it('시각만 있는 조각은 앞에서 지정한 요일의 다음 회차로 본다', () => {
    const r = parseHours('수요일·목요일 10:00~12:00 / 14:00~16:00', 2026);
    expect(openDays('수요일·목요일 10:00~12:00 / 14:00~16:00')).toEqual(['wed', 'thu']);
    expect(r.weekdays.wed.intervals).toEqual([
      { open: '10:00', close: '12:00' },
      { open: '14:00', close: '16:00' },
    ]);
  });

  it('시각 말고 다른 말이 붙은 조각은 앞 요일을 물려받지 않는다', () => {
    // "(동절기) 10:00~18:00" 은 주말의 다음 회차가 아니라 계절별 안내다
    const t = '평일 10:00 ~ 20:00 / 주말(하절기) 10:00 ~ 19:00 (동절기) 10:00 ~ 18:00';
    expect(span(t, 'mon')).toBe('10:00-20:00');
    expect(span(t, 'sat')).toBe('10:00-19:00');
    expect(parseHours(t, 2026).weekdays.sat.intervals).toHaveLength(1);
  });

  it('회차로 적힌 요일에는 note 를 붙인다', () => {
    expect(parseHours('1회차14:00-15:20 / 2회차16:00-17:20', 2026).weekdays.mon.note).toBe('회차 운영');
    expect(parseHours('1회차 14:00~15:20', 2026).weekdays.mon.note).toBe('회차 운영');
    expect(parseHours('오전반(10:30~12:00), 오후반(13:30~15:00)', 2026).weekdays.mon.note).toBe('회차 운영');
    expect(parseHours('1부: 10:00~12:00 / 2부: 14:00~16:00', 2026).weekdays.mon.note).toBe('회차 운영');
  });

  it('격주 회차는 그 요일에만 note 를 붙인다', () => {
    const r = parseHours('1, 3째주 토 1회차(3,4학년) 13:30-15:00 2회차(5,6학년) 15:30-17:00', 2026);
    expect(r.weekdays.sat.note).toBe('회차 운영');
    expect(r.weekdays.mon.note).toBeUndefined();
  });

  it('회차 표시가 없으면 구간이 여럿이어도 note 를 붙이지 않는다', () => {
    expect(parseHours('수요일·목요일 10:00~12:00 / 14:00~16:00', 2026).weekdays.wed.note).toBeUndefined();
    expect(parseHours('10:00~18:00 (※ 12~13시 휴관)', 2026).weekdays.mon.note).toBeUndefined();
    expect(parseHours('주말부 10:00~18:00', 2026).weekdays.mon.note).toBeUndefined();
  });

  it('상시 관람과 회차가 섞인 요일에는 note 를 붙이지 않는다', () => {
    const r = parseHours('화-일 10:00~18:00 / 토 1회차 14:00~15:00 2회차 16:00~17:00', 2026);
    expect(r.weekdays.sat.note).toBeUndefined();
  });

  it('회차에 연장 운영이 겹치면 note 를 잇는다', () => {
    const r = parseHours('1회차 10:00~12:00 / 2회차 14:00~16:00 ※ 금요일은 21:00까지', 2026);
    expect(r.weekdays.fri.note).toBe('회차 운영 · 연장 운영');
    expect(r.weekdays.mon.note).toBe('회차 운영');
  });

  it('요일이 지정된 구간은 지정 없는 구간을 덮어쓴다', () => {
    const r = parseHours('10:00~18:00 / 토 12:00~18:00', 2026);
    expect(span('10:00~18:00 / 토 12:00~18:00', 'mon')).toBe('10:00-18:00');
    expect(r.weekdays.sat.intervals).toEqual([{ open: '12:00', close: '18:00' }]);
  });
});

describe('parseHours — 중간 휴관', () => {
  it('점심 휴관이 있으면 구간을 둘로 쪼갠다', () => {
    const r = parseHours('10:00 ~ 18:00 (※ 12~13시 휴관)', 2026);
    expect(r.weekdays.mon.intervals).toEqual([
      { open: '10:00', close: '12:00' },
      { open: '13:00', close: '18:00' },
    ]);
  });

  it('쉬는 구간이 운영시간 밖이면 쪼개지 않는다', () => {
    const r = parseHours('13:00 ~ 18:00 (※ 11~12시 휴관)', 2026);
    expect(r.weekdays.mon.intervals).toEqual([{ open: '13:00', close: '18:00' }]);
  });
});

describe('parseHours — 연장 운영', () => {
  it('특정 요일만 늦게 닫는다', () => {
    const t = '10:00~18:00 (평일, 주말 동일) 매주 금요일 21:00까지';
    expect(span(t, 'thu')).toBe('10:00-18:00');
    expect(span(t, 'fri')).toBe('10:00-21:00');
  });

  it('요일 뒤에 조사가 붙어도 읽는다', () => {
    const t = '10:00~18:00 (평일, 주말 동일) ※ 매주 금요일은 21:00까지';
    expect(span(t, 'thu')).toBe('10:00-18:00');
    expect(span(t, 'fri')).toBe('10:00-21:00');
  });

  it('요일이 여러 개면 전부 늦게 닫는다', () => {
    const t = '10:00~18:00 ※ 화,수,금 21:00까지';
    expect(span(t, 'tue')).toBe('10:00-21:00');
    expect(span(t, 'wed')).toBe('10:00-21:00');
    expect(span(t, 'fri')).toBe('10:00-21:00');
    expect(span(t, 'thu')).toBe('10:00-18:00');
  });

  it('기본 시간이 없으면 여는 시각을 몰라 unknown 으로 둔다', () => {
    // 추측해서 열어 두면 잘못된 "가능"이 나온다
    for (const t of [
      '금 21:00까지',
      '금요일 21:00까지 연장 운영',
      '매주 금요일은 21:00까지',
      '화,수,금 21:00까지',
      '9.15.(화)부터 화,수,금,토,일 21:00까지',
    ]) {
      const r = parseHours(t, 2026);
      expect(r.scheduleType, t).toBe('unknown');
      expect(r.weekdays.fri.isOpen, t).toBe(false);
    }
  });

  it('연장 운영에는 note 를 붙인다', () => {
    expect(parseHours('10:00~18:00 ※ 화,수,금 21:00까지', 2026).weekdays.fri.note).toBe('연장 운영');
  });

  it('"금요일"의 일을 일요일로 세지 않는다', () => {
    const t = '화 - 일 10:00~18:00 ※월요일 휴관, 금요일 21:00 까지 야간개관';
    expect(span(t, 'fri')).toBe('10:00-21:00');
    expect(span(t, 'sun')).toBe('10:00-18:00');
  });
});

describe('parseHours — 요일이 시각 뒤에 올 때', () => {
  it('"화-토요일 운영"처럼 뒤에 붙은 요일도 읽는다', () => {
    expect(openDays('10:00~18:00, 화-토요일 운영'))
      .toEqual(['tue', 'wed', 'thu', 'fri', 'sat']);
  });

  it('"(매주 토요일)"처럼 괄호에 든 것도 읽는다', () => {
    expect(openDays('10:00~12:00 (매주 토요일)')).toEqual(['sat']);
  });

  it('앞 조각이 요일만 적고 끝났으면 다음 조각에 적용한다', () => {
    expect(openDays('기간 내 매주 토요일 / 13:00~14:30')).toEqual(['sat']);
  });

  it('뒤에 온 요일이 휴관 요일이면 운영 요일로 오인하지 않는다', () => {
    // "일,월 휴관" 을 지정으로 읽으면 일·월만 여는 꼴이 된다
    expect(openDays('10:00~18:00, 일,월 휴관'))
      .toEqual(['tue', 'wed', 'thu', 'fri', 'sat']);
  });

  it('"월-일요일"은 7일 전부로 둔다', () => {
    expect(openDays('월-일요일 11:00~20:00')).toEqual(ORDER);
  });
});

describe('parseHours — 특정 날짜 예외', () => {
  it('날짜가 적힌 일정은 exceptions로 뺀다', () => {
    const r = parseHours('화-일요일 10:00~18:00 / 11.17(화) 오픈식 14:00~16:00', 2026);
    expect(r.exceptions).toEqual([
      { date: '2026-11-17', schedule: { isOpen: true, intervals: [{ open: '14:00', close: '16:00' }] } },
    ]);
  });

  it('예외로 뺀 시각이 요일 규칙에 남지 않는다', () => {
    // "오픈식 14:00~16:00" 이 월요일에까지 들어가면 안 된다.
    // 앞에서 "화-일요일"이라고 했으므로 월요일은 운영하지 않는 날이다
    const t = '화-일요일 10:00~18:00 / 11.17(화) 오픈식 14:00~16:00';
    expect(openDays(t)).toEqual(['tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    expect(span(t, 'tue')).toBe('10:00-18:00');
  });

  it('끝 시각만 적힌 날짜는 그 요일의 여는 시각을 가져다 쓴다', () => {
    const r = parseHours('평일 11:00~19:00 / 토 12:00~18:00 / 심야갤러리 11.5.(목) 22:00까지', 2026);
    expect(r.exceptions).toEqual([
      { date: '2026-11-05', schedule: { isOpen: true, intervals: [{ open: '11:00', close: '22:00' }] } },
    ]);
  });

  it('"N월 N일(요일)" 형식도 읽는다', () => {
    const r = parseHours('10:30~12:00 (90분) *10월 11일(토)은 휴관', 2026);
    expect(r.exceptions).toEqual([
      { date: '2026-10-11', schedule: { isOpen: false, intervals: [] } },
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

describe('parseHours — 격주·N째주', () => {
  it('"1, 3째주 토"를 weeksOfMonth로 담는다', () => {
    const r = parseHours('1, 3째주 토 1회차(3,4학년) 13:30-15:00 2회차(5,6학년) 15:30-17:00', 2026);
    expect(openDays('1, 3째주 토 1회차(3,4학년) 13:30-15:00 2회차(5,6학년) 15:30-17:00')).toEqual(['sat']);
    expect(r.weekdays.sat.weeksOfMonth).toEqual([1, 3]);
    // 회차가 둘이면 구간도 둘이다
    expect(r.weekdays.sat.intervals).toEqual([
      { open: '13:30', close: '15:00' },
      { open: '15:30', close: '17:00' },
    ]);
  });

  it('"2, 4째주"도 담는다', () => {
    expect(parseHours('2, 4째주 토 1회차 14:00~15:20 2회차 16:00~17:20', 2026).weekdays.sat.weeksOfMonth)
      .toEqual([2, 4]);
  });

  it('"첫째·셋째 주"처럼 한글로 적힌 것도 담는다', () => {
    expect(parseHours('첫째·셋째 주 토요일 10:00~12:00', 2026).weekdays.sat.weeksOfMonth)
      .toEqual([1, 3]);
  });

  it('매주 하는 전시에는 weeksOfMonth를 넣지 않는다', () => {
    expect(parseHours('10:00~18:00', 2026).weekdays.mon.weeksOfMonth).toBeUndefined();
  });
});

describe('parseHours — N일부터 일정이 바뀌는 경우', () => {
  it('기본 일정은 그대로 두고 periods에 담는다', () => {
    const t = '화-일 10:00~18:00 ※ 월 휴관, 9.15.(화)부터 화,수,금,토,일 21:00까지';
    const r = parseHours(t, 2026);
    // 9월 15일 전에는 18시까지다. 바로 반영하면 아직 없는 야간개관을 "가능"으로 안내한다
    expect(span(t, 'tue')).toBe('10:00-18:00');
    expect(r.periods).toHaveLength(1);
    expect(r.periods![0].from).toBe('2026-09-15');
    expect(r.periods![0].weekdays.tue.intervals[0].close).toBe('21:00');
    // 목요일은 목록에 없으므로 그대로다
    expect(r.periods![0].weekdays.thu.intervals[0].close).toBe('18:00');
  });

  it('"2024년 4월 12일(금)부터" 형식도 읽는다', () => {
    const r = parseHours('10:00 ~ 18:00 (평일, 주말 동일) ※ 2024년 4월 12일(금)부터 매주 금요일은 21:00까지 야간개관합니다.', 2026);
    expect(r.periods![0].from).toBe('2024-04-12');
    expect(r.periods![0].weekdays.fri.intervals[0].close).toBe('21:00');
  });

  it('기준일을 하루짜리 예외로 넣지 않는다', () => {
    const r = parseHours('10:00 ~ 18:00 ※ 2024년 4월 12일(금)부터 매주 금요일은 21:00까지', 2026);
    expect(r.exceptions).toEqual([]);
  });

  it('바뀌는 게 없으면 periods를 넣지 않는다', () => {
    expect(parseHours('10:00~18:00', 2026).periods).toBeUndefined();
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
