import { describe, it, expect, vi } from 'vitest';
import type { Venue, Exhibition, JudgeInput, JudgeResult } from '../types';
import type { JudgeFn } from './judge';
import { findStartCandidates } from './slots';
import { toMinutes, fromMinutes } from './time';

const venue: Venue = {
  id: 'v1',
  name: '테스트 시설',
  aliases: [],
  gu: '종로구',
  type: '미술관',
  lat: 37.5665,
  lng: 126.978,
  representative: true,
  source: 'test',
  verified: '2026-11-10',
  visitMinutes: 60,
};

const exhibition: Exhibition = {
  id: 'e1',
  venueId: 'v1',
  title: '테스트 전시',
  start: '2026-11-01',
  end: '2026-11-30',
};

const baseInput = { venue, exhibition, date: '2026-11-10', holidays: [] };

/** 받은 출발 시각을 그대로 입장 시각으로 돌려주는 '항상 가능' 가짜 judge. */
const ok = (input: JudgeInput): JudgeResult => {
  const s = toMinutes(input.stayStart)!;
  return {
    result: 'possible',
    reasons: [],
    entryTime: input.stayStart,
    endTime: fromMinutes(s + 60),
    slackMinutes: 0,
  };
};

describe('findStartCandidates', () => {
  it('judge를 주입받아 30분 간격 출발 시각마다 호출한다', () => {
    const judge = vi.fn<JudgeFn>(ok);
    findStartCandidates(baseInput, [{ start: '10:00', end: '12:00' }], judge, 10);
    expect(judge.mock.calls.map(([i]) => i.stayStart)).toEqual(['10:00', '10:30', '11:00']);
    // stayEnd는 range.end로 넘기고 나머지 입력은 그대로 전달한다.
    expect(judge.mock.calls[0][0]).toMatchObject({ ...baseInput, stayEnd: '12:00' });
  });

  it('시작 시각을 30분 단위로 올림한다 (10:10 → 10:30)', () => {
    const judge = vi.fn<JudgeFn>(ok);
    const res = findStartCandidates(baseInput, [{ start: '10:10', end: '12:00' }], judge, 10);
    expect(judge.mock.calls[0][0].stayStart).toBe('10:30');
    expect(res.possible).toEqual(['10:30', '11:00']);
  });

  it('후보 + 관람 시간이 range.end를 넘으면 후보로 만들지 않는다', () => {
    const judge = vi.fn<JudgeFn>(ok);
    const res = findStartCandidates(baseInput, [{ start: '10:00', end: '10:50' }], judge);
    expect(judge).not.toHaveBeenCalled();
    expect(res).toEqual({ possible: [], unavailable: [], unknown: [] });
  });

  it('visitMinutes가 없으면 기본값(60분)으로 끝을 보장한다', () => {
    const judge = vi.fn<JudgeFn>(ok);
    const input = { ...baseInput, venue: { ...venue, visitMinutes: undefined } };
    findStartCandidates(input, [{ start: '10:00', end: '11:30' }], judge, 10);
    expect(judge.mock.calls.map(([i]) => i.stayStart)).toEqual(['10:00', '10:30']);
  });

  it('브레이크 타임으로 나뉜 구간은 각각 따로 후보를 만든다', () => {
    const judge = vi.fn<JudgeFn>(ok);
    const res = findStartCandidates(
      baseInput,
      [
        { start: '10:00', end: '11:30' },
        { start: '13:00', end: '14:30' },
      ],
      judge,
      10,
    );
    expect(res.possible).toEqual(['10:00', '10:30', '13:00', '13:30']);
    // 11:30~13:00 사이 시각은 묻지 않고, 각 구간의 끝을 stayEnd로 넘긴다.
    expect(judge.mock.calls.map(([i]) => `${i.stayStart}-${i.stayEnd}`)).toEqual([
      '10:00-11:30',
      '10:30-11:30',
      '13:00-14:30',
      '13:30-14:30',
    ]);
  });

  it('impossible은 사유와 함께 unavailable에 기록하고 같은 사유가 이어지면 묶는다', () => {
    const judge: JudgeFn = (input) =>
      input.stayStart >= '11:00'
        ? { result: 'impossible', reasons: ['입장 마감(11:00) 이후입니다'] }
        : ok(input);
    const res = findStartCandidates(baseInput, [{ start: '10:00', end: '13:00' }], judge, 10);
    expect(res.possible).toEqual(['10:00', '10:30']);
    expect(res.unavailable).toEqual([
      { range: '11:00~12:00', reason: '입장 마감(11:00) 이후입니다' },
    ]);
    expect(res.unknown).toEqual([]);
  });

  it('unknown은 unavailable에 넣지 않고 unknown 배열로 분리한다', () => {
    const judge: JudgeFn = (input) =>
      input.stayStart === '10:30'
        ? { result: 'unknown', reasons: ['입장 마감 정보가 없습니다'] }
        : ok(input);
    const res = findStartCandidates(baseInput, [{ start: '10:00', end: '12:00' }], judge, 10);
    expect(res.unknown).toEqual(['10:30']);
    expect(res.unavailable).toEqual([]);
    expect(res.possible).toEqual(['10:00', '11:00']);
  });

  it('possible은 최대 limit개까지만 담는다 (기본 3)', () => {
    const res = findStartCandidates(baseInput, [{ start: '10:00', end: '18:00' }], ok);
    expect(res.possible).toEqual(['10:00', '10:30', '11:00']);
    const one = findStartCandidates(baseInput, [{ start: '10:00', end: '18:00' }], ok, 1);
    expect(one.possible).toEqual(['10:00']);
  });

  it('개관 전 출발이 같은 입장 시각으로 당겨지면 한 번만 담는다', () => {
    const judge: JudgeFn = (input) => ({
      ...ok(input),
      entryTime: input.stayStart < '10:00' ? '10:00' : input.stayStart,
    });
    const res = findStartCandidates(baseInput, [{ start: '09:00', end: '12:00' }], judge, 10);
    expect(res.possible).toEqual(['10:00', '10:30', '11:00']);
  });
});
