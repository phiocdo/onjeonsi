import type { JudgeInput, JudgeResult } from '../types';
import { REASONS } from './reasons';

/** 판정 함수의 시그니처. 구현이 바뀌어도 이 타입은 유지한다. */
export type JudgeFn = (input: JudgeInput) => JudgeResult;

/**
 * 스텁: 판정 로직은 아직 없고 항상 '확인 필요'를 돌려준다.
 * 화면이 같은 시그니처로 먼저 붙을 수 있도록 먼저 배포한다.
 * 실제 구현은 feat/judge 브랜치에서 이 상수를 교체한다.
 */
export const judge: JudgeFn = () => ({
  result: 'unknown',
  reasons: [REASONS.NOT_IMPLEMENTED],
});