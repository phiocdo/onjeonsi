import { describe, expect, it } from 'vitest';
import { allowedVisitRange, isShareableVisitDate, visitDateProblem, visitFormNotice } from './visitDate';

const TODAY = '2026-11-23';
// 발견 경위의 전시 (auto-seoul-160108)
const NOT_STARTED = { start: '2026-12-21', end: '2026-12-29' };
const ENDED = { start: '2026-10-01', end: '2026-11-10' };
const RUNNING = { start: '2026-11-01', end: '2026-12-31' };

describe('visitDateProblem', () => {
  it('시작 전 전시: 오늘 날짜는 BEFORE_START, 문구 고정', () => {
    expect(visitDateProblem(TODAY, NOT_STARTED, TODAY)).toEqual({
      code: 'BEFORE_START',
      message: '이 전시는 12월 21일에 시작해요. 전시 기간(12/21~12/29) 안의 날짜를 골라 주세요.',
    });
  });

  it('끝난 전시: 종료일 뒤는 AFTER_END, 문구 고정', () => {
    expect(visitDateProblem('2026-11-11', ENDED, TODAY)).toEqual({
      code: 'AFTER_END',
      message: '이 전시는 11월 10일에 끝났어요. 전시 기간(10/1~11/10) 안의 날짜를 골라 주세요.',
    });
  });

  it('진행 중 전시: 기간 안 지난 날짜와 오늘은 문제 없음', () => {
    expect(visitDateProblem('2026-11-05', RUNNING, TODAY)).toBeNull();
    expect(visitDateProblem(TODAY, RUNNING, TODAY)).toBeNull();
  });

  it('오늘 이후는 FUTURE, 문구 고정', () => {
    expect(visitDateProblem('2026-11-24', RUNNING, TODAY)).toEqual({
      code: 'FUTURE',
      message: '아직 오지 않은 날짜예요. 다녀온 뒤에 기록해 주세요.',
    });
  });

  it('경계일: 시작일·종료일·오늘 당일은 허용', () => {
    expect(visitDateProblem('2026-10-01', ENDED, TODAY)).toBeNull();
    expect(visitDateProblem('2026-11-10', ENDED, TODAY)).toBeNull();
    expect(visitDateProblem('2026-09-30', ENDED, TODAY)?.code).toBe('BEFORE_START');
    expect(visitDateProblem(TODAY, { start: TODAY, end: TODAY }, TODAY)).toBeNull();
  });

  it('기간 정보가 없으면 그쪽 경계는 검사하지 않는다 (빈 문자열·null 포함)', () => {
    expect(visitDateProblem('2000-01-01', {}, TODAY)).toBeNull();
    expect(visitDateProblem('2000-01-01', { start: '', end: null }, TODAY)).toBeNull();
    expect(visitDateProblem('2000-01-01', { end: '2026-12-31' }, TODAY)).toBeNull();
    expect(visitDateProblem('2026-11-20', { start: '2026-11-01' }, TODAY)).toBeNull();
    expect(visitDateProblem('2026-11-20', { end: '2026-11-10' }, TODAY)).toEqual({
      code: 'AFTER_END',
      message: '이 전시는 11월 10일에 끝났어요. 전시 기간(~11/10) 안의 날짜를 골라 주세요.',
    });
    expect(visitDateProblem('2026-10-20', { start: '2026-11-01' }, TODAY)?.message).toBe(
      '이 전시는 11월 1일에 시작해요. 전시 기간(11/1~) 안의 날짜를 골라 주세요.',
    );
  });

  it('형식이 틀리거나 달력에 없는 날짜는 INVALID_DATE', () => {
    expect(visitDateProblem('', RUNNING, TODAY)?.code).toBe('INVALID_DATE');
    expect(visitDateProblem('2026/11/05', RUNNING, TODAY)?.code).toBe('INVALID_DATE');
    expect(visitDateProblem('2026-02-30', RUNNING, TODAY)?.code).toBe('INVALID_DATE');
  });

  it('검사 순서: INVALID_DATE → FUTURE → BEFORE_START → AFTER_END', () => {
    expect(visitDateProblem('bad', NOT_STARTED, TODAY)?.code).toBe('INVALID_DATE');
    // 오늘 이후이면서 시작 전이면 FUTURE가 먼저
    expect(visitDateProblem('2026-12-01', NOT_STARTED, TODAY)?.code).toBe('FUTURE');
    // 시작일이 종료일보다 늦은(잘못된) 기간이면 BEFORE_START가 먼저
    expect(visitDateProblem('2026-11-15', { start: '2026-11-20', end: '2026-11-10' }, TODAY)?.code).toBe('BEFORE_START');
  });

  it('checkFuture: false면 FUTURE를 보지 않고 기간만 본다', () => {
    expect(visitDateProblem('2026-11-24', RUNNING, TODAY, { checkFuture: false })).toBeNull();
    expect(visitDateProblem('2026-12-01', NOT_STARTED, TODAY, { checkFuture: false })?.code).toBe('BEFORE_START');
  });
});

describe('allowedVisitRange', () => {
  it('진행 중: min=시작일, max=오늘', () => {
    expect(allowedVisitRange(RUNNING, TODAY)).toEqual({ min: '2026-11-01', max: TODAY, empty: false });
  });

  it('끝난 전시: max=종료일', () => {
    expect(allowedVisitRange(ENDED, TODAY)).toEqual({ min: '2026-10-01', max: '2026-11-10', empty: false });
  });

  it('시작 전: 고를 수 있는 날이 없다 (empty)', () => {
    expect(allowedVisitRange(NOT_STARTED, TODAY)).toEqual({ min: '2026-12-21', max: TODAY, empty: true });
  });

  it('오늘 시작하는 전시는 오늘 하루만', () => {
    expect(allowedVisitRange({ start: TODAY, end: '2026-12-31' }, TODAY)).toEqual({ min: TODAY, max: TODAY, empty: false });
  });

  it('기간 정보가 없으면 min 없이 max=오늘', () => {
    expect(allowedVisitRange({}, TODAY)).toEqual({ max: TODAY, empty: false });
    expect(allowedVisitRange({ start: null, end: '' }, TODAY)).toEqual({ max: TODAY, empty: false });
  });
});

describe('visitFormNotice', () => {
  it('시작 전 전시는 날짜와 상관없이 시작 전 문구', () => {
    expect(visitFormNotice(TODAY, NOT_STARTED, TODAY)).toBe('이 전시는 아직 시작 전이라 기록할 수 없어요 (12/21 시작).');
    expect(visitFormNotice('2026-12-22', NOT_STARTED, TODAY)).toBe('이 전시는 아직 시작 전이라 기록할 수 없어요 (12/21 시작).');
  });

  it('그 밖에는 visitDateProblem 문구, 문제 없으면 null', () => {
    expect(visitFormNotice('2026-11-11', ENDED, TODAY)).toBe(visitDateProblem('2026-11-11', ENDED, TODAY)?.message);
    expect(visitFormNotice('2026-11-24', RUNNING, TODAY)).toBe('아직 오지 않은 날짜예요. 다녀온 뒤에 기록해 주세요.');
    expect(visitFormNotice('2026-11-05', RUNNING, TODAY)).toBeNull();
  });
});

describe('isShareableVisitDate', () => {
  it('기간 밖(BEFORE_START·AFTER_END)만 빼고, FUTURE는 보지 않는다', () => {
    expect(isShareableVisitDate('2026-11-23', NOT_STARTED, TODAY)).toBe(false);
    expect(isShareableVisitDate('2026-11-11', ENDED, TODAY)).toBe(false);
    expect(isShareableVisitDate('2026-11-05', RUNNING, TODAY)).toBe(true);
    // 시계 차이로 하루 앞선 기록도 기간 안이면 공유
    expect(isShareableVisitDate('2026-11-24', RUNNING, TODAY)).toBe(true);
    expect(isShareableVisitDate('2000-01-01', { start: null, end: null }, TODAY)).toBe(true);
  });
});
