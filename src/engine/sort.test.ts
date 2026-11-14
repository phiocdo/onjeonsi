import { describe, it, expect } from 'vitest';
import type { JudgeResult } from '../types';
import { rankExhibitions } from './sort';

type Item = { id: string; judge: JudgeResult; distance?: number };

const possible = (slackMinutes?: number): JudgeResult => ({
  result: 'possible',
  reasons: [],
  entryTime: '10:00',
  endTime: '11:00',
  slackMinutes,
});
const unknown: JudgeResult = { result: 'unknown', reasons: ['정보 없음'] };
const impossible: JudgeResult = { result: 'impossible', reasons: ['휴관'] };

const ids = (items: Item[]) => items.map((i) => i.id);

describe('rankExhibitions', () => {
  it('판정 결과를 possible > unknown > impossible 순으로 놓는다', () => {
    const items: Item[] = [
      { id: 'c', judge: impossible },
      { id: 'b', judge: unknown },
      { id: 'a', judge: possible(10) },
    ];
    expect(ids(rankExhibitions(items))).toEqual(['a', 'b', 'c']);
  });

  it('같은 판정이면 여유 시간이 큰 순으로 놓는다', () => {
    const items: Item[] = [
      { id: 'small', judge: possible(10) },
      { id: 'big', judge: possible(120) },
      { id: 'mid', judge: possible(60) },
    ];
    expect(ids(rankExhibitions(items))).toEqual(['big', 'mid', 'small']);
  });

  it('여유 시간 값이 없으면 같은 판정 안에서 뒤로 민다', () => {
    const items: Item[] = [
      { id: 'none', judge: possible(undefined) },
      { id: 'zero', judge: possible(0) },
    ];
    expect(ids(rankExhibitions(items))).toEqual(['zero', 'none']);
  });

  it('여유 시간 0은 값으로 보아 120 → 0 → 없음 순으로 놓는다', () => {
    const items: Item[] = [
      { id: 'a-none', judge: possible(undefined) },
      { id: 'b-zero', judge: possible(0) },
      { id: 'c-big', judge: possible(120) },
    ];
    expect(ids(rankExhibitions(items))).toEqual(['c-big', 'b-zero', 'a-none']);
  });

  it('여유 시간이 같으면 거리가 가까운 순으로 놓는다', () => {
    const items: Item[] = [
      { id: 'far', judge: possible(30), distance: 3000 },
      { id: 'near', judge: possible(30), distance: 200 },
    ];
    expect(ids(rankExhibitions(items))).toEqual(['near', 'far']);
  });

  it('거리가 undefined/null/NaN이면 맨 뒤로 보낸다', () => {
    const items: Item[] = [
      { id: 'undef', judge: unknown },
      { id: 'nan', judge: unknown, distance: NaN },
      { id: 'null', judge: unknown, distance: null as unknown as number },
      { id: 'far', judge: unknown, distance: 5000 },
      { id: 'near', judge: unknown, distance: 100 },
    ];
    const ranked = ids(rankExhibitions(items));
    expect(ranked.slice(0, 2)).toEqual(['near', 'far']);
    // 거리 없는 세 항목은 id 순으로 고정된다.
    expect(ranked.slice(2)).toEqual(['nan', 'null', 'undef']);
  });

  it('모든 조건이 같으면 id 순으로 고정한다', () => {
    const items: Item[] = [
      { id: 'e2', judge: impossible, distance: 100 },
      { id: 'e10', judge: impossible, distance: 100 },
      { id: 'e1', judge: impossible, distance: 100 },
    ];
    expect(ids(rankExhibitions(items))).toEqual(['e1', 'e10', 'e2']);
  });

  it('입력 배열을 바꾸지 않고 새 배열을 돌려준다', () => {
    const items: Item[] = [
      { id: 'c', judge: impossible },
      { id: 'a', judge: possible(10) },
      { id: 'b', judge: unknown },
    ];
    const snapshot = [...items];
    const ranked = rankExhibitions(items);
    expect(ranked).not.toBe(items);
    expect(items).toEqual(snapshot);
    expect(ids(items)).toEqual(['c', 'a', 'b']);
  });
});
