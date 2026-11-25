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

  it('날짜의 "월"·"일"은 휴관 요일로 읽지 않는다', () => {
    // "1월 1일" 의 월·일을 요일로 읽으면 매주 월·일요일이 휴관이 된다
    expect(openDays('10:00~18:00 ※ 1월 1일 휴관')).toEqual(ORDER);
    expect(openDays('10:00~18:00 ※ 12 월 25 일 휴관')).toEqual(ORDER);
    // 진짜 요일과 날짜가 같이 있으면 요일만 닫는다
    expect(openDays('10:00~18:00, 매주 월요일 및 1월 1일 휴관'))
      .toEqual(['tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
  });

  it('"당일"·"공휴일"·"평일"의 "일"은 일요일로 읽지 않는다', () => {
    expect(openDays('10:00~18:00 ※ 설·추석 당일 휴관')).toEqual(ORDER);
    expect(openDays('10:00~18:00 ※ 공휴일 휴관')).toEqual(ORDER);
    expect(openDays('10:00~18:00 ※ 평일 휴관')).toEqual(ORDER);
    // 요일 목록 안의 "일" 은 그대로 일요일이다
    expect(openDays('10:00~18:00 (일, 월, 공휴일 휴관)')).toEqual(['tue', 'wed', 'thu', 'fri', 'sat']);
    expect(openDays('10:00~18:00 ※ 토일 휴관')).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
  });

  it('휴관 목록이 길어도 앞쪽 요일을 놓치지 않는다', () => {
    // 휴관 바로 앞 20자만 보면 "매주 월요일"이 잘려 나가 월요일에 틀린 "가능"이 나온다
    const notMon = ['tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    expect(openDays('10:00~18:00 (매주 월요일, 매년 1월 1일 및 설·추석 당일 휴관)')).toEqual(notMon);
    expect(openDays('10:00~18:00 ※ 매주 월요일, 1월 1일, 설날 및 추석 당일 휴관')).toEqual(notMon);
    // 명절도 그대로 읽는다
    const r = parseHours('10:00~18:00 (매주 월요일, 매년 1월 1일 및 설·추석 당일 휴관)', 2026);
    expect(r.exceptions.map(e => e.date)).toContain('2026-09-25');
  });

  it('긴 휴관 목록을 덧붙일 때 앞의 다른 안내까지 끌어오지 않는다', () => {
    // 휴관 목록 낱말이 아닌 말("도슨트", "야간개관", 괄호 닫힘)이 나오면 거기서 멈춘다
    const notMon = ['tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    expect(openDays('10:00~18:00 (토, 일 도슨트), 매주 월요일, 1월 1일 및 설·추석 당일 휴관')).toEqual(notMon);
    expect(openDays('10:00~18:00 (야간개관: 금, 토), 매주 월요일, 1월 1일 및 설·추석 당일 휴관')).toEqual(notMon);
  });

  it('20자 안의 휴관 대상은 예전처럼 닫는다', () => {
    // 덧붙이기만 하고 20자 창은 줄이지 않는다. 줄이면 닫히던 요일을 놓친다
    expect(openDays('10:00~18:00 (17:30 입장마감) 매주 월요일, 공휴일 휴관')).not.toContain('mon');
    expect(openDays('10:00~18:00 (월요일, 개관기념일, 공휴일 휴관)')).not.toContain('mon');
    expect(openDays('10:00~18:00 (일/월 휴관)')).toEqual(['tue', 'wed', 'thu', 'fri', 'sat']);
  });

  it('휴관 요일 뒤에 괄호 설명이 붙어도 그 요일을 닫는다', () => {
    const notMon = ['tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    expect(openDays('10:00~18:00, 매주 월요일(공휴일인 경우 다음날) 휴관')).toEqual(notMon);
    expect(openDays('10:00~18:00 매주 월요일(단, 공휴일 개관) 휴관')).toEqual(notMon);
  });

  it('띄어 쓰지 않은 휴관 요일도 놓치지 않는다', () => {
    // 앞 글자가 한글이라고 모두 건너뛰면 휴관 요일을 놓쳐 틀린 "가능"이 나온다
    const notMon = ['tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    expect(openDays('10:00~18:00 (매주월요일 휴관)')).toEqual(notMon);
    expect(openDays('10:00~18:00 (공휴일및월요일 휴관)')).toEqual(notMon);
    expect(openDays('10:00~18:00 (매월 2, 4 월요일 휴관)')).toEqual(notMon);
    expect(openDays('10:00~18:00 (일요일과월요일 휴관)')).toEqual(['tue', 'wed', 'thu', 'fri', 'sat']);
    expect(openDays('10:00~18:00 (매주월·화 휴관)')).toEqual(['wed', 'thu', 'fri', 'sat', 'sun']);
  });

  it('명절 휴관은 공휴일 전체가 아니라 그 날짜만 닫는다', () => {
    // 공휴일 전체를 닫으면 성탄절·어린이날도 "확실한 휴관"이 된다
    const r = parseHours('10:00~17:30, 매주 월요일 및 추석 당일 휴관', 2026);
    expect(r.holiday).toBeNull();
    expect(r.exceptions.map(e => e.date)).toEqual(['2026-09-25', '2027-09-15']);
    expect(r.exceptions.every(e => !e.schedule.isOpen)).toBe(true);
    expect(r.weekdays.mon.isOpen).toBe(false);
  });

  it('당일이 없으면 명절 연휴 3일을 닫는다', () => {
    const dates = parseHours('10:00~18:00 (설 연휴 휴관)', 2026).exceptions.map(e => e.date);
    expect(dates).toEqual(['2026-02-16', '2026-02-17', '2026-02-18', '2027-02-06', '2027-02-07', '2027-02-08']);
  });

  it('명절과 같이 적힌 양력 날짜도 닫는다', () => {
    // 예전에는 공휴일 전체를 닫아 1월 1일이 저절로 닫혔다. 빠뜨리면 틀린 "가능"이 된다
    const dates = parseHours('10:00~18:00 ※ 1월 1일, 설날 및 추석 당일 휴관', 2026).exceptions.map(e => e.date);
    expect(dates).toContain('2026-01-01');
    expect(dates).toContain('2027-01-01');
    expect(dates).toContain('2026-02-17');
  });

  it('명절 날짜를 모르는 해면 예전처럼 공휴일 전체를 닫는다', () => {
    // 2028년 전시는 2029년까지 봐야 하는데 2029년이 표에 없다
    expect(parseHours('10:00~18:00 ※ 설·추석 당일 휴관', 2028).holiday).toEqual({ isOpen: false, intervals: [] });
  });

  it('"설치", "설명"의 설은 설날이 아니다', () => {
    const r = parseHours('10:00~18:00 ※ 작품 설치 기간 휴관', 2026);
    expect(r.holiday).toBeNull();
    expect(r.exceptions).toEqual([]);
  });

  it('공휴일 언급이 없으면 holiday는 null이다', () => {
    expect(parseHours('10:00~18:00', 2026).holiday).toBeNull();
  });
});

describe('parseHours — 명절 없이 적힌 휴관 날짜', () => {
  /** 휴관(isOpen: false)으로 들어간 날짜 예외만 돌려준다 */
  const closedDates = (text: string, year = 2026) =>
    parseHours(text, year).exceptions.filter(e => !e.schedule.isOpen).map(e => e.date);

  it('"1월 1일 휴관"만 있어도 매년 1월 1일을 닫는다', () => {
    // 명절 말이 없다고 건너뛰면 2027-01-01(금)에 틀린 "가능"이 나온다
    const t = '화~일 10:00~18:00 / 매주 월요일, 1월 1일 휴관';
    expect(closedDates(t, 2026)).toEqual(['2026-01-01', '2027-01-01']);
    expect(closedDates(t, 2027)).toEqual(['2027-01-01', '2028-01-01']);
    const r = parseHours(t, 2026);
    expect(r.holiday).toBeNull();
    expect(r.weekdays.mon.isOpen).toBe(false);
    expect(r.weekdays.fri.isOpen).toBe(true);
  });

  it('휴무·쉽니다·쉼으로 적어도 닫는다', () => {
    expect(closedDates('화~일 10:00~18:00 / 매주 월요일, 1월 1일 휴무')).toEqual(['2026-01-01', '2027-01-01']);
    expect(closedDates('10:00~18:00 / 1월 1일은 쉽니다')).toEqual(['2026-01-01', '2027-01-01']);
    expect(closedDates('10:00~18:00 (1월 1일 쉼)')).toEqual(['2026-01-01', '2027-01-01']);
  });

  it('날짜가 여러 개면 모두 닫는다', () => {
    const dates = closedDates('화~일 10:00~18:00 / 매주 월요일, 1월 1일, 12월 25일 휴관');
    expect(dates).toEqual(expect.arrayContaining(['2026-01-01', '2026-12-25', '2027-01-01', '2027-12-25']));
    expect(dates).toHaveLength(4);
  });

  it('명절과 같이 적힌 경우는 예전과 같다', () => {
    const r = parseHours('10:00~18:00 ※ 1월 1일, 설날 및 추석 당일 휴관', 2026);
    expect(r.holiday).toBeNull();
    expect(r.exceptions.map(e => e.date)).toEqual([
      '2026-01-01', '2026-02-17', '2026-09-25', '2027-01-01', '2027-02-07', '2027-09-15',
    ]);
  });

  it('시간이 붙은 날짜는 휴관이 아니다', () => {
    expect(parseHours('10:00~18:00 / 11월 22일은 16:00까지', 2026).exceptions).toEqual([]);
    expect(closedDates('10:00~18:00 / 11월 22일은 16:00까지 / 매주 월요일, 1월 1일 휴관'))
      .toEqual(['2026-01-01', '2027-01-01']);
    // 요일이 붙은 날짜 예외("11월 22일(일)은 16:00까지")는 그대로 시간 변경 예외로 남는다
    const r = parseHours('10:00~18:00 / 11월 22일(일)은 16:00까지 / 1월 1일 휴관', 2026);
    expect(r.exceptions.find(e => e.date === '2026-11-22')).toEqual({
      date: '2026-11-22',
      schedule: { isOpen: true, intervals: [{ open: '10:00', close: '16:00' }] },
    });
    expect(closedDates('10:00~18:00 / 11월 22일(일)은 16:00까지 / 1월 1일 휴관'))
      .toEqual(['2026-01-01', '2027-01-01']);
  });

  it('기간 표기의 날짜는 휴관이 아니다', () => {
    expect(closedDates('10:00~18:00 / 2026년 11월 1일 ~ 12월 31일 / 매주 월요일 휴관')).toEqual([]);
    expect(closedDates('10:00~18:00, 전시기간 11월 1일 ~ 12월 31일, 매주 월요일 휴관')).toEqual([]);
    expect(closedDates('10:00~18:00, 11월 1일-12월 31일, 매주 월요일 휴관')).toEqual([]);
    // 양 끝에 연도가 붙어도 기간이다
    expect(closedDates('10:00~18:00, 2026년 11월 1일 ~ 2027년 1월 31일, 매주 월요일 휴관')).toEqual([]);
    expect(closedDates('10:00~18:00, 전시기간 2027년 1월 1일, 매주 월요일 휴관')).toEqual([]);
  });

  it('연도가 적힌 날짜는 그 해 그 날 하루만 닫는다', () => {
    // "2027년 1월 1일" 은 그 해 하루뿐이다. 매년으로 늘리면 2026-01-01·2028-01-01 에 틀린 "불가"가 나온다
    const t = '10:00~18:00 / 매주 월요일, 2027년 1월 1일 휴관';
    expect(closedDates(t, 2026)).toEqual(['2027-01-01']);
    expect(closedDates(t, 2027)).toEqual(['2027-01-01']);
    expect(closedDates(t, 2026)).not.toContain('2028-01-01');
    expect(parseHours(t, 2026).weekdays.mon.isOpen).toBe(false);
    expect(closedDates('10:00~18:00 / 2027년 1월 1일 휴관')).toEqual(['2027-01-01']);
  });

  it('연도가 적힌 날짜가 여러 개면 그 날짜들만 닫는다', () => {
    expect(closedDates('10:00~18:00 / 2026년 12월 31일, 2027년 1월 1일 휴관')).toEqual(['2026-12-31', '2027-01-01']);
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

  it('계절 안내는 다음 회차가 아니라 같은 요일의 다른 계절 시간으로 본다', () => {
    // "(동절기) 10:00~18:00" 은 주말의 다음 회차가 아니다. 예전에는 버려서 동절기에도 19:00 까지로 읽었다
    const t = '평일 10:00 ~ 20:00 / 주말(하절기) 10:00 ~ 19:00 (동절기) 10:00 ~ 18:00';
    expect(span(t, 'mon')).toBe('10:00-20:00');
    expect(parseHours(t, 2026).weekdays.sat.intervals).toHaveLength(1);
  });
});

describe('parseHours — 계절별 시간', () => {
  it('계절마다 시간이 다르면 겹치는 시간만 쓴다', () => {
    // 어느 계절인지 모르고 긴 쪽을 쓰면 동절기 18~19시에 틀린 "가능"이 나온다
    const t = '평일 10:00 ~ 20:00 / 주말(하절기) 10:00 ~ 19:00 (동절기) 10:00 ~ 18:00';
    expect(span(t, 'sat')).toBe('10:00-18:00');
    expect(span(t, 'sun')).toBe('10:00-18:00');
    expect(span('하절기 09:00~18:00 / 동절기 09:00~17:00', 'mon')).toBe('09:00-17:00');
  });

  it('여는 시각이 다르면 늦게 여는 쪽을 쓴다', () => {
    expect(span('하절기 09:00~18:00 / 동절기 10:00~18:00', 'mon')).toBe('10:00-18:00');
  });

  it('계절 표시가 한쪽에만 있어도 같은 요일 시간과 합친다', () => {
    const r = parseHours('화-일 10:00~18:00 / 동절기 10:00~17:00', 2026);
    expect(r.weekdays.sat.intervals).toEqual([{ open: '10:00', close: '17:00' }]);
    expect(r.weekdays.mon.isOpen).toBe(false);
  });

  it('입장 마감은 합친 시간에 맞춘다', () => {
    const r = parseHours('하절기(3~10월) 10:00~19:00, 동절기(11~2월) 10:00~18:00 ※ 입장마감 30분 전', 2026);
    expect(r.weekdays.mon.intervals).toEqual([{ open: '10:00', close: '18:00', lastAdmission: '17:30' }]);
  });

  it('계절이 아닌 말("겨울방학")은 계절로 보지 않는다', () => {
    const r = parseHours('평일 10:00~18:00 / 겨울방학 프로그램 14:00~16:00', 2026);
    expect(r.weekdays.mon.intervals).toEqual([{ open: '10:00', close: '18:00' }]);
  });

  it('계절 구간을 합쳐도 회차 표시(sessions)는 유지한다', () => {
    // 합친 구간은 새 객체라서, 회차 여부를 따로 넘겨주지 않으면 sessions 가 빠진다
    const r = parseHours('하절기 1회차 10:00~12:00 / 동절기 1회차 10:00~11:30', 2026);
    expect(r.weekdays.mon.intervals).toEqual([{ open: '10:00', close: '11:30' }]);
    expect(r.weekdays.mon.sessions).toBe(true);
    expect(r.weekdays.mon.note).toBe('회차 운영');
  });

  it('합친 계절 구간 중 하나라도 상시 관람이면 sessions 를 붙이지 않는다', () => {
    const r = parseHours('하절기 10:00~19:00 / 동절기 1회차 10:00~18:00', 2026);
    expect(r.weekdays.mon.intervals).toEqual([{ open: '10:00', close: '18:00' }]);
    expect(r.weekdays.mon.sessions).toBeUndefined();
  });

  it('회차와 중간 휴관은 계절 처리에 영향받지 않는다', () => {
    expect(parseHours('1회차 10:00~12:00 / 2회차 14:00~16:00', 2026).weekdays.mon.intervals).toHaveLength(2);
    expect(parseHours('10:00~18:00 (※ 12~13시 휴관)', 2026).weekdays.mon.intervals).toHaveLength(2);
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

  it('회차 요일에는 sessions 를 붙여 판정이 note 문자열을 보지 않게 한다', () => {
    const r = parseHours('1회차 14:00~15:20 / 2회차 16:00~17:20', 2026);
    expect(r.weekdays.mon.sessions).toBe(true);
    expect(parseHours('10:00~18:00', 2026).weekdays.mon.sessions).toBeUndefined();
    expect(parseHours('화-일 10:00~18:00 / 토 1회차 14:00~15:00', 2026).weekdays.sat.sessions)
      .toBeUndefined();
  });

  it('번호 없이 회차·타임이 들어간 말은 회차로 보지 않는다', () => {
    // "타임스퀘어" 같은 장소 이름을 회차로 보면 상시 관람 전시가 판정에서 빠진다
    for (const t of ['타임스퀘어 10:00~22:00', '회차별 상이 10:00~18:00', '라이프타임 10:00~18:00']) {
      const mon = parseHours(t, 2026).weekdays.mon;
      expect(mon.sessions, t).toBeUndefined();
      expect(mon.note, t).toBeUndefined();
    }
    expect(parseHours('A타임 10:00~11:00 / B타임 14:00~15:00', 2026).weekdays.mon.sessions).toBe(true);
    expect(parseHours('1타임 10:00~11:00', 2026).weekdays.mon.sessions).toBe(true);
  });

  it('번호 없는 "타임"은 앞 구간의 요일을 물려받지 않는다', () => {
    const t = '토 10:00~12:00 타임스퀘어 14:00~16:00';
    expect(parseHours(t, 2026).weekdays.sat.intervals).toEqual([{ open: '10:00', close: '12:00' }]);
    // 번호가 있으면 같은 요일의 다음 회차다
    expect(parseHours('토 A타임 10:00~12:00 B타임 14:00~16:00', 2026).weekdays.sat.intervals).toHaveLength(2);
  });

  it('회차 요일에는 연장 운영을 적용하지 않는다', () => {
    // 마지막 회차를 21:00 까지 늘리면 없는 회차를 만들게 된다
    const r = parseHours('1회차 10:00~12:00 / 2회차 14:00~16:00 ※ 금요일은 21:00까지', 2026);
    expect(r.weekdays.fri.intervals).toEqual([
      { open: '10:00', close: '12:00' },
      { open: '14:00', close: '16:00' },
    ]);
    expect(r.weekdays.fri.note).toBe('회차 운영');
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

  it('회차 요일에는 끝 시각만 적힌 날짜 예외를 만들지 않는다', () => {
    // 첫 회차 시작~22:00 을 한 구간으로 만들면 그날만 회차가 아닌 날이 되어 틀린 "가능"이 나온다
    const r = parseHours('1회차 14:00~15:20 / 2회차 16:00~17:20 / 심야 11.5.(목) 22:00까지', 2026);
    expect(r.exceptions).toEqual([]);
    expect(r.weekdays.thu.sessions).toBe(true);
  });

  it('구간이 나뉜 요일은 마지막 구간만 늘린다', () => {
    // 첫 여는 시각~22:00 한 구간으로 만들면 중간에 쉬는 시간도 "가능"이 된다
    const r = parseHours('목 10:00~12:00 / 목 14:00~18:00 / 심야 11.5.(목) 22:00까지', 2026);
    expect(r.exceptions).toEqual([
      {
        date: '2026-11-05',
        schedule: {
          isOpen: true,
          intervals: [
            { open: '10:00', close: '12:00' },
            { open: '14:00', close: '22:00' },
          ],
        },
      },
    ]);
  });

  it('날짜 예외로 늘린 구간은 입장 마감도 같은 간격만큼 옮긴다', () => {
    // 17:30 을 그대로 두면 22:00까지 여는 날에도 17:30 뒤 방문이 불가로 나온다
    const r = parseHours('화-일 10:00~18:00 (17:30까지 입장가능) / 11.5.(목) 22:00까지', 2026);
    expect(r.exceptions).toEqual([
      {
        date: '2026-11-05',
        schedule: { isOpen: true, intervals: [{ open: '10:00', close: '22:00', lastAdmission: '21:30' }] },
      },
    ]);
  });

  it('평소보다 일찍 닫는 날은 입장 마감도 앞당긴다', () => {
    const r = parseHours('화-일 10:00~18:00 (17:30까지 입장가능) / 11.5.(목) 16:00까지', 2026);
    expect(r.exceptions[0].schedule.intervals).toEqual([{ open: '10:00', close: '16:00', lastAdmission: '15:30' }]);
  });

  it('쉬는 요일의 날짜에는 끝 시각만으로 예외를 만들지 않는다', () => {
    // 그날 여는 시각을 모르므로 지어내지 않는다
    const r = parseHours('화-일 10:00~18:00 (17:30까지 입장가능) / 11.2.(월) 22:00까지', 2026);
    expect(r.exceptions).toEqual([]);
    expect(r.weekdays.mon.isOpen).toBe(false);
  });

  it('요일 연장 운영도 입장 마감을 같이 옮긴다', () => {
    const r = parseHours('화-일 10:00~18:00 (17:30까지 입장가능), 금 21:00까지 야간개관', 2026);
    expect(r.weekdays.fri.intervals).toEqual([{ open: '10:00', close: '21:00', lastAdmission: '20:30' }]);
    expect(r.weekdays.thu.intervals).toEqual([{ open: '10:00', close: '18:00', lastAdmission: '17:30' }]);
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

describe('parseHours — 입장 가능 시각', () => {
  it('"17:30까지 입장가능"을 입장 마감으로 읽는다', () => {
    const r = parseHours('매주 화 - 일 10:00~18:00 (17:30까지 입장가능)', 2026);
    expect(r.weekdays.tue.intervals).toEqual([{ open: '10:00', close: '18:00', lastAdmission: '17:30' }]);
  });

  it('"입장은 17:00까지"도 읽는다', () => {
    expect(parseHours('10:00~18:00 입장은 17:00까지', 2026).weekdays.mon.intervals[0].lastAdmission).toBe('17:00');
  });

  it('입장이 붙지 않은 "까지"는 입장 마감이 아니다', () => {
    // 연장 운영 문구다
    expect(parseHours('10:00~18:00 금요일은 21:00까지', 2026).weekdays.mon.intervals[0].lastAdmission).toBeUndefined();
  });

  it('폐관보다 늦은 입장 시각은 버린다', () => {
    expect(parseHours('10:00~18:00 (19:00까지 입장가능)', 2026).weekdays.mon.intervals[0].lastAdmission).toBeUndefined();
  });
});

describe('parseHours — 반복 회차', () => {
  it('"매 정각마다"는 회차로 본다', () => {
    // 상시 관람으로 읽으면 18:30 에 가도 "가능"이 나온다
    const r = parseHours('18:00 ~ 22:00, 매 정각마다', 2026);
    expect(r.weekdays.mon.sessions).toBe(true);
    expect(r.weekdays.mon.intervals).toEqual([{ open: '18:00', close: '22:00' }]);
    expect(parseHours('10:00~17:00 매시 정각 입장', 2026).weekdays.mon.sessions).toBe(true);
  });

  it('정각 도슨트·해설은 관람 회차가 아니다', () => {
    expect(parseHours('10:00~18:00 / 매 정각 도슨트 운영', 2026).weekdays.mon.sessions).toBeUndefined();
    expect(parseHours('10:00~18:00, 매 정각 도슨트 해설', 2026).weekdays.mon.sessions).toBeUndefined();
  });
});

describe('parseHours — 기간의 끝 날짜', () => {
  it('"부터 ~까지"의 끝 날짜를 to 에 넣는다', () => {
    const r = parseHours('화-일 10:00~18:00 ※ 월 휴관, 9.15.(화)부터 12.31.(목)까지 화,수,금 21:00까지', 2026);
    expect(r.periods).toHaveLength(1);
    expect(r.periods?.[0].from).toBe('2026-09-15');
    expect(r.periods?.[0].to).toBe('2026-12-31');
    expect(r.periods?.[0].weekdays.fri.intervals[0].close).toBe('21:00');
  });

  it('끝 달이 시작 달보다 앞이면 다음 해로 본다', () => {
    const r = parseHours('화-일 10:00~18:00, 11.1.부터 2.28.까지 금 20:00까지', 2026);
    expect(r.periods?.[0].to).toBe('2027-02-28');
  });

  it('끝 날짜가 없으면 to 를 넣지 않는다', () => {
    // "21:00까지"는 시각이지 날짜가 아니다
    const r = parseHours('화-일 10:00~18:00 ※ 월 휴관, 9.15.(화)부터 화,수,금,토,일 21:00까지', 2026);
    expect(r.periods?.[0].to).toBeUndefined();
  });
});

// 2026-11-25 해석기 버그 묶음. 서울시 API 전체(고유 문구 9,290건)를 고치기 전후로 풀어 비교해 확인했다
describe('parseHours — 요일이 아닌 글자를 요일로 읽지 않는다', () => {
  const ALL_BUT = (...days: Weekday[]) => ORDER.filter(d => !days.includes(d));
  const closedDates = (text: string, year = 2026) =>
    parseHours(text, year).exceptions.filter(e => !e.schedule.isOpen).map(e => e.date);

  it('날짜에 붙은 요일의 휴관은 그 날 하루만 닫는다', () => {
    // 예전에는 매주 토요일을 닫았다
    expect(openDays('10:00~18:00, 11월 21일(토) 휴관')).toEqual(ORDER);
    expect(closedDates('10:00~18:00, 11월 21일(토) 휴관')).toEqual(['2026-11-21']);
    expect(openDays('10:00 - 18:00, 03.30(일), 04.06(일) 휴관')).toEqual(ORDER);
    expect(closedDates('10:00 - 18:00, 03.30(일), 04.06(일) 휴관')).toEqual(['2026-03-30', '2026-04-06']);
  });

  it('"4/13(월)" 처럼 빗금으로 적은 날짜도 날짜 예외로 읽는다', () => {
    expect(openDays('11:00 ~ 18:00, 4/13(월) 하루만 휴관')).toEqual(ORDER);
    expect(closedDates('11:00 ~ 18:00, 4/13(월) 하루만 휴관')).toEqual(['2026-04-13']);
  });

  it('"(금요일)" 처럼 괄호 안에 요일을 다 적어도 날짜 예외로 읽는다', () => {
    const r = parseHours('10:00~20:00 * 2024년 04월 26일(금요일)은 관람시간이 변경됩니다. 변경 관람시간 : 17:00~20:00', 2024);
    expect(span('10:00~20:00 * 2024년 04월 26일(금요일)은 관람시간 변경 17:00~20:00', 'fri', 2024)).toBe('10:00-20:00');
    expect(r.exceptions).toEqual([{ date: '2024-04-26', schedule: { isOpen: true, intervals: [{ open: '17:00', close: '20:00' }] } }]);
  });

  it('기간의 월·일을 월·일요일로 읽지 않는다', () => {
    // 예전에는 월·일요일만 열었다. 점 표기("11.1 ~ 12.31")는 원래 맞았다
    expect(openDays('11월 1일 ~ 12월 31일 10:00~18:00')).toEqual(ORDER);
    expect(openDays('11.1 ~ 12.31 10:00~18:00')).toEqual(ORDER);
  });

  it('"금일·일부·일시" 같은 낱말의 글자로 요일을 닫지 않는다', () => {
    expect(openDays('10:00~18:00 금일 휴관')).toEqual(ORDER);
    expect(openDays('10:00~18:00 (일부 전시실 휴관)')).toEqual(ORDER);
    expect(openDays('10:00~18:00, 시설 점검으로 일시 휴관')).toEqual(ORDER);
    expect(openDays('10:00~18:00, 시설 수리로 휴관')).toEqual(ORDER);
    // 요일 목록은 그대로 닫는다
    expect(openDays('10:00~18:00 (목금일 휴관)')).toEqual(ALL_BUT('thu', 'fri', 'sun'));
    expect(openDays('10:00~18:00 (월휴관)')).toEqual(ALL_BUT('mon'));
  });
});

describe('parseHours — 날짜에 붙은 요일로 운영 요일 정하기', () => {
  it('괄호가 바로 붙은 요일도 운영 요일로 읽는다', () => {
    // 예전에는 "(수)" 를 못 읽어 7일 모두 열었다
    expect(openDays('매주 (수) 14:00 ~ 16:00')).toEqual(['wed']);
    expect(openDays('(화-토) 10:00~21:00 (일) 10:00~18:00')).toEqual(['tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    expect(openDays('금요일(20일, 27일) 18:30~21:00')).toEqual(['fri']);
  });

  it('날짜 목록에 붙은 요일은 그 요일에만 연다', () => {
    expect(openDays('6월 4, 11, 18일(토) 13:00 ~ 16:00')).toEqual(['sat']);
  });

  it('날짜 범위 양 끝의 요일은 요일 범위로 읽는다', () => {
    expect(openDays('19(화) ~ 23(토) 10:00~17:00')).toEqual(['tue', 'wed', 'thu', 'fri', 'sat']);
    // 일주일이 넘는 범위는 요일 지정이 아니다
    expect(openDays('2022-01-04(화) ~ 2022-01-16(일) 11:00~15:00')).toEqual(ORDER);
  });

  it('낱말 안의 글자는 요일이 아니다', () => {
    // "(심화)" 의 '화' 를 화요일로 읽지 않는다
    expect(openDays('매주 토요일 (기초)11:00~12:15 / (심화)13:00~14:15')).toEqual(['sat']);
  });
});

describe('parseHours — 휴관 목록 앞뒤의 다른 안내', () => {
  const closedDates = (text: string, year = 2026) =>
    parseHours(text, year).exceptions.filter(e => !e.schedule.isOpen).map(e => e.date);

  it('휴관 말 앞의 운영 안내 요일은 닫지 않는다', () => {
    // 예전에는 토·일까지 닫았다
    expect(openDays('10:00~18:00 토·일 야간개관 운영, 월 휴관')).toEqual(['tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    expect(openDays('10:00~18:00, 화-토요일 운영, 일/월/공휴일 휴관')).toEqual(['tue', 'wed', 'thu', 'fri', 'sat']);
  });

  it('운영 안내가 아닌 낱말이 끼어도 휴관 요일은 닫는다', () => {
    // 휴관 목록 낱말이 아니라고 모두 자르면 월요일을 놓쳐 틀린 "가능"이 나온다
    expect(openDays('10:00~18:00 (월요일, 개관기념일, 공휴일 휴관)')).not.toContain('mon');
    expect(openDays('10:00~18:00 매주 월요일(단, 공휴일 개관) 휴관')).not.toContain('mon');
  });

  it('휴관 말 뒤에 오는 목록도 읽는다', () => {
    const notMon = ['tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    expect(openDays('10:00~18:00 정기 휴관: 매주 월요일')).toEqual(notMon);
    expect(openDays('10:00~18:00 (휴관일: 매주 월요일)')).toEqual(notMon);
    expect(openDays('10:00~18:00 / 정기휴관 월요일')).toEqual(notMon);
    const r = parseHours('평일 : 화요일-토요일 (11:00~18:00) / 휴관 : 공휴일 및 일요일, 월요일', 2026);
    expect(ORDER.filter(d => r.weekdays[d].isOpen)).toEqual(['tue', 'wed', 'thu', 'fri', 'sat']);
    expect(r.holiday).toEqual({ isOpen: false, intervals: [] });
    expect(closedDates('10:00~18:00 (휴관일: 1월 1일)')).toEqual(['2026-01-01', '2027-01-01']);
  });

  it('휴관 말 뒤라도 다음 운영 안내의 요일은 닫지 않는다', () => {
    expect(openDays('화-일 10:00~18:00, 월 휴관, 토 10:00~12:00 체험')).toContain('sat');
    expect(openDays('10:00~18:00 월요일 휴관 토요일 10:00~12:00 체험')).toContain('sat');
  });

  it('성탄절은 12월 25일로 닫는다', () => {
    expect(closedDates('10:00~18:00 (12월 25일(성탄절) 휴관)')).toEqual(['2026-12-25', '2027-12-25']);
    expect(closedDates('10:00~18:00, 1월 1일, 성탄절 휴관')).toEqual(['2026-01-01', '2026-12-25', '2027-01-01', '2027-12-25']);
    expect(closedDates('10:00 ~ 18:00 (매주 월요일, 크리스마스 당일 휴무)')).toEqual(['2026-12-25', '2027-12-25']);
  });
});

describe('parseHours — 없는 날짜', () => {
  it('2월 30일 같은 없는 날짜는 만들지 않는다', () => {
    expect(parseHours('10:00~18:00, 2월 30일 휴관', 2026).exceptions).toEqual([]);
    expect(parseHours('10:00~18:00, 2.30(월) 휴관', 2026).exceptions).toEqual([]);
    expect(parseHours('10:00~18:00, 4월 31일 휴관', 2026).exceptions).toEqual([]);
  });

  it('2월 29일은 윤년에만 닫는다', () => {
    const dates = parseHours('10:00~18:00, 2월 29일 휴관', 2027).exceptions.map(e => e.date);
    expect(dates).toEqual(['2028-02-29']);
  });
});

describe('parseHours — 달 범위로 적은 계절별 시간', () => {
  it('달 범위 시간은 겹치는 시간만 남긴다', () => {
    // 판정 날짜가 어느 범위인지 보지 않으므로 긴 쪽을 쓰면 겨울 17~18시에 틀린 "가능"이 나온다
    expect(span('3~10월 09:30~18:00 / 11~2월 09:30~17:00', 'mon')).toBe('09:30-17:00');
    expect(span('4월-10월 09:00~21:00 / 11월-3월 09:00~20:00', 'sat')).toBe('09:00-20:00');
    expect(openDays('4월-10월 09:00~21:00 / 11월-3월 09:00~20:00')).toEqual(ORDER);
  });
});

describe('parseHours — "평일" 과 요일 범위가 같이 적힌 경우', () => {
  it('범위를 따른다', () => {
    // "평일" 만 보고 월~금을 열면 월요일에 틀린 "가능"이 나온다
    expect(openDays('평일(화-금) 10:00~20:00 / 토.일.공휴일 10:00~18:00')).not.toContain('mon');
    expect(span('평일(화-금) 10:00~20:00', 'tue')).toBe('10:00-20:00');
    expect(openDays('평일 10:00~18:00')).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
  });
});

describe('parseHours — 점으로 이은 요일', () => {
  it('"토.일.공휴일" 의 토요일도 연다', () => {
    // 예전에는 토요일을 못 읽어 닫았다(일요일은 "공휴일" 의 '일' 로 열렸다)
    expect(openDays('평일(화-금) 10:00~20:00 / 토.일.공휴일 10:00~18:00')).toEqual(['tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    expect(span('평일(화-금) 10:00~20:00 / 토.일.공휴일 10:00~18:00', 'sat')).toBe('10:00-18:00');
  });
});

// 2026-11-25 코드 리뷰에서 나온 경우
describe('parseHours — 코드 리뷰 회귀', () => {
  const closedDates = (text: string, year = 2026) =>
    parseHours(text, year).exceptions.filter(e => !e.schedule.isOpen).map(e => e.date);

  it('날짜 예외로 못 읽은 날짜의 요일은 예전처럼 매주 닫는다', () => {
    // 그 날 하루를 놓쳐 틀린 "가능"이 나오는 것보다 낫다
    expect(openDays('10:00~18:00, 2026-11-21(토) 휴관')).not.toContain('sat');
    expect(openDays('10:00~18:00, 20(금), 21(토) 휴관')).not.toContain('fri');
    // 날짜 예외가 된 날짜는 그 날만 닫는다
    expect(openDays('10:00~18:00, 11월 20일(금)~21일(토) 휴관')).toContain('fri');
    expect(closedDates('10:00~18:00, 11월 20일(금)~21일(토) 휴관')).toEqual(['2026-11-20']);
  });

  it('"2, 4 월요일" 의 월을 날짜로 지우지 않는다', () => {
    expect(openDays('매월 2, 4 월요일 14:00~16:00')).toEqual(['mon']);
    expect(openDays('매월 1, 3 일요일 10:00~12:00')).toEqual(['sun']);
  });

  it('휴관 말 뒤의 연장·운영 안내 요일은 닫지 않는다', () => {
    expect(span('10:00~18:00 월요일 휴관 매주 금, 토요일 21:00까지 연장', 'fri')).toBe('10:00-21:00');
    expect(span('10:00~18:00 월 휴관 토요일, 일요일 10:00~17:00', 'sat')).toBe('10:00-17:00');
    // 뒤에 "정상 개관" 같은 설명이 붙어도 앞의 휴관 날짜는 읽는다
    expect(closedDates('10:00~19:00 / 휴관일: 1월 1일 , 매주 월요일 월요일이 공휴일인 경우 정상 개관'))
      .toEqual(['2026-01-01', '2027-01-01']);
  });

  it('관람료·입장료 같은 낱말이 끼어도 휴관 요일을 닫는다', () => {
    expect(openDays('10:00~18:00, 매주 월요일, 관람료 무료, 공휴일 휴관')).not.toContain('mon');
  });

  it('"월정기휴관" 의 월요일을 닫는다', () => {
    expect(openDays('10:00~18:00 월정기휴관')).not.toContain('mon');
  });

  it('빗금으로 적은 연도를 읽는다', () => {
    expect(closedDates('10:00~18:00, 2025/12/27(토) 휴관')).toEqual(['2025-12-27']);
  });

  it('달이 다른 날짜 범위는 요일 범위가 아니다', () => {
    expect(openDays('2026-01-04(화) ~ 2026-02-05(토) 11:00~15:00')).toEqual(ORDER);
  });

  it('성탄절 전날은 12월 24일이다', () => {
    expect(closedDates('10:00~18:00 (월요일, 성탄절 전날 휴관)')).toEqual(['2026-12-24', '2027-12-24']);
  });

  it('"공휴일." 의 일을 일요일로 읽지 않는다', () => {
    expect(openDays('화-토 10:00~18:00 / 공휴일. 10:00~17:00')).not.toContain('sun');
  });

  it('"목, 금일" 은 요일 목록이다', () => {
    expect(openDays('10:00~18:00, 목, 금일 휴관')).toEqual(['mon', 'tue', 'wed', 'sat']);
  });
});
