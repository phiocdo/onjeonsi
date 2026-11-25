import { describe, expect, it } from 'vitest';
import { GLANCE_LAST, GLANCE_MINUTES, glanceQuery, glanceWindow } from './glance';

const TODAY = '2026-11-24';

describe('glanceWindow', () => {
  it.each([
    ['00:05', '00:00', '02:00'],
    ['09:37', '09:30', '11:30'],
    ['12:00', '12:00', '14:00'],
    ['21:49', '21:40', '23:40'],
    ['21:55', '21:50', '23:50'],
    ['22:30', '22:30', '23:50'],
    ['23:45', '23:40', '23:50'],
    ['23:55', '23:40', '23:50'],
  ])('%s → %s~%s', (time, start, end) => {
    expect(glanceWindow(time)).toEqual({ start, end });
  });

  it.each([
    ['00:00', '00:00', '02:00'],
    ['21:50', '21:50', '23:50'], // 2시간이 정확히 23:50에 닿는 마지막 시각
    ['21:59', '21:50', '23:50'],
    ['23:40', '23:40', '23:50'],
    ['23:50', '23:40', '23:50'], // 시작 = 끝이 되므로 23:40~23:50
    ['23:59', '23:40', '23:50'],
  ])('경계 %s → %s~%s', (time, start, end) => {
    expect(glanceWindow(time)).toEqual({ start, end });
  });

  it('하루 모든 분에서 start < end이고 둘 다 10분 단위, end는 23:50 이하', () => {
    for (let t = 0; t < 24 * 60; t++) {
      const time = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
      const { start, end } = glanceWindow(time);
      expect(start < end, time).toBe(true);
      expect(end <= GLANCE_LAST, time).toBe(true);
      expect(start.endsWith('0') && end.endsWith('0'), time).toBe(true);
    }
  });

  it('구간 길이는 2시간이 기본', () => {
    expect(GLANCE_MINUTES).toBe(120);
  });

  it('형식을 검사하지 않는다: 숫자로 못 읽으면 NaN:NaN (판정 엔진이 형식 오류로 처리)', () => {
    expect(glanceWindow('abc')).toEqual({ start: 'NaN:NaN', end: 'NaN:NaN' });
    expect(glanceWindow('')).toEqual({ start: 'NaN:NaN', end: 'NaN:NaN' });
    // 한 자리 숫자는 숫자로 읽힌다
    expect(glanceWindow('9:05')).toEqual({ start: '09:00', end: '11:00' });
  });
});

describe('glanceQuery', () => {
  it('날짜와 glanceWindow 구간', () => {
    expect(glanceQuery(TODAY, '13:17')).toEqual({ date: TODAY, stayStart: '13:10', stayEnd: '15:10' });
    expect(glanceQuery(TODAY, '23:55')).toEqual({ date: TODAY, stayStart: '23:40', stayEnd: '23:50' });
  });
});
