import { describe, it, expect } from 'vitest';
import { addDays, fromMinutes, toMinutes, weekdayOf } from './time';

describe('weekdayOf', () => {
  it('로컬 날짜 기준 요일을 돌려준다 (UTC로 밀리지 않음)', () => {
    expect(weekdayOf('2026-11-09')).toBe('mon');
    expect(weekdayOf('2026-11-10')).toBe('tue');
    expect(weekdayOf('2026-11-14')).toBe('sat');
    expect(weekdayOf('2026-11-15')).toBe('sun');
  });

  it('연초·윤일도 요일이 맞다', () => {
    expect(weekdayOf('2026-01-01')).toBe('thu');
    expect(weekdayOf('2028-02-29')).toBe('tue');
  });
});

describe('addDays', () => {
  it('월·연 경계를 넘긴다', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('하루를 뺀 날의 요일이 하나 앞선다', () => {
    expect(weekdayOf(addDays('2026-11-10', -1))).toBe('mon');
  });
});

describe('toMinutes / fromMinutes', () => {
  it('HH:MM을 분으로 바꾸고 형식이 틀리면 null', () => {
    expect(toMinutes('00:00')).toBe(0);
    expect(toMinutes('19:30')).toBe(1170);
    expect(toMinutes('9:30')).toBeNull();
    expect(toMinutes('24:00')).toBeNull();
    expect(toMinutes('12:60')).toBeNull();
    expect(toMinutes('')).toBeNull();
  });

  it('분을 두 자리 HH:MM으로 되돌린다', () => {
    expect(fromMinutes(0)).toBe('00:00');
    expect(fromMinutes(545)).toBe('09:05');
    expect(fromMinutes(toMinutes('18:00') ?? -1)).toBe('18:00');
  });
});
