import { describe, it, expect } from 'vitest';
import type { Venue, Exhibition, JudgeInput } from '../types';
import { judge } from './judge';
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

  it('10. lastEntry 없음 + 나머지 통과 -> unknown', () => {
    const result = judge(makeInput({ venue: { lastEntry: undefined } }));
    expect(result.result).toBe('unknown');
    expect(result.reasons).toEqual([REASONS.MISSING_LAST_ENTRY]);
  });

  it('11. 어긴 조건이 있고 lastEntry도 없음 -> impossible (사유에 누락 정보가 섞이지 않음)', () => {
    const result = judge(makeInput({ date: '2026-10-01', venue: { lastEntry: undefined } }));
    expect(result.result).toBe('impossible');
    expect(result.reasons).toEqual([REASONS.OUT_OF_PERIOD]);
  });
});
