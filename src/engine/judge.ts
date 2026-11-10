import type { JudgeInput, JudgeResult } from '../types';
import { isOpen } from './isOpen';
import { toMinutes, fromMinutes } from './time';
import { REASONS } from './reasons';
import { DEFAULT_VISIT_MINUTES } from './constants';

export type JudgeFn = (input: JudgeInput) => JudgeResult;

export const judge: JudgeFn = (input) => {
  const { venue, exhibition, date, stayStart, stayEnd, holidays } = input;
  const reasons: string[] = [];
  const missing: string[] = [];

  // 1) 전시 기간 판정
  if (date < exhibition.start || date > exhibition.end) {
    reasons.push(REASONS.OUT_OF_PERIOD);
  }

  // 2) 시설 운영 여부 판정
  const op = isOpen(venue, date, holidays);

  if (op.status === 'closed') {
    reasons.push(op.reason);
  } else if (op.status === 'unknown') {
    missing.push(op.reason);
  } else {
    // op.status === 'open'
    const sStart = toMinutes(stayStart);
    const vOpen = toMinutes(op.open);
    const close = toMinutes(op.close);
    const end = toMinutes(stayEnd);
    const d = venue.visitMinutes ?? DEFAULT_VISIT_MINUTES;

    if (sStart === null || vOpen === null || close === null || end === null) {
      missing.push(REASONS.MISSING_HOURS);
    } else {
      const s = Math.max(sStart, vOpen);

      if (!op.lastEntry) {
        missing.push(REASONS.MISSING_LAST_ENTRY);
      } else {
        const le = toMinutes(op.lastEntry);
        if (le === null) {
          missing.push(REASONS.MISSING_LAST_ENTRY);
        } else if (s > le) {
          reasons.push(REASONS.AFTER_LAST_ENTRY(op.lastEntry));
        }
      }

      if (s + d > close) {
        reasons.push(REASONS.NOT_ENOUGH_BEFORE_CLOSE);
      }
      if (s + d > end) {
        reasons.push(REASONS.NOT_ENOUGH_STAY);
      }

      // 위반 조건이 있으면 불가 우선
      if (reasons.length > 0) {
        return { result: 'impossible', reasons };
      }
      // 위반은 없고 정보만 부족하면 확인 필요
      if (missing.length > 0) {
        return { result: 'unknown', reasons: missing };
      }

      // 모든 조건을 통과한 경우
      return {
        result: 'possible',
        reasons: [],
        entryTime: fromMinutes(s),
        endTime: fromMinutes(s + d),
        slackMinutes: Math.min(close, end) - (s + d),
      };
    }
  }

  // op.status가 closed/unknown이거나 시간 형식 오류인 경우
  if (reasons.length > 0) {
    return { result: 'impossible', reasons };
  }
  if (missing.length > 0) {
    return { result: 'unknown', reasons: missing };
  }

  return { result: 'unknown', reasons: [REASONS.MISSING_HOURS] };
};
