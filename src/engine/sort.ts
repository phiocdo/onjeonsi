import type { JudgeResult } from '../types';

type Rankable = { judge: JudgeResult; distance?: number; id: string };

/** 판정 결과 우선순위. 작을수록 앞. '확인 필요'는 '불가'보다 앞에 둔다. */
const RESULT_ORDER: Record<JudgeResult['result'], number> = {
  possible: 0,
  unknown: 1,
  impossible: 2,
};

const isValidNumber = (n: number | null | undefined): n is number =>
  typeof n === 'number' && !Number.isNaN(n);

/** 값이 있는 쪽을 앞으로. 둘 다 있으면 null을 돌려 다음 비교로 넘긴다. */
function compareMissing(a: number | null | undefined, b: number | null | undefined): number | null {
  const hasA = isValidNumber(a);
  const hasB = isValidNumber(b);
  if (hasA && hasB) return null;
  if (hasA) return -1;
  if (hasB) return 1;
  return 0;
}

/**
 * 전시 목록을 다음 순서로 정렬한 새 배열을 돌려준다. 입력 배열은 바꾸지 않는다.
 * 1) 판정: possible > unknown > impossible
 * 2) 여유 시간(slackMinutes) 큰 순. 값이 없으면 뒤로.
 * 3) 거리 가까운 순. null/undefined/NaN이면 뒤로.
 * 4) id 문자열 순.
 */
export function rankExhibitions<T extends Rankable>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const byResult = RESULT_ORDER[a.judge.result] - RESULT_ORDER[b.judge.result];
    if (byResult !== 0) return byResult;

    const sa = a.judge.slackMinutes;
    const sb = b.judge.slackMinutes;
    const slackMissing = compareMissing(sa, sb);
    if (slackMissing === null) {
      if (sa !== sb) return (sb as number) - (sa as number);
    } else if (slackMissing !== 0) {
      return slackMissing;
    }

    const da = a.distance;
    const db = b.distance;
    const distMissing = compareMissing(da, db);
    if (distMissing === null) {
      if (da !== db) return (da as number) - (db as number);
    } else if (distMissing !== 0) {
      return distMissing;
    }

    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}
