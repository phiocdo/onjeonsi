import type { JudgeInput, JudgeResult, Venue, Weekday } from '../types';
import { isOpen } from './isOpen';
import { toMinutes, fromMinutes, weekdayOf, addDays } from './time';
import { REASONS } from './reasons';
import { DEFAULT_VISIT_MINUTES } from './constants';

export type JudgeFn = (input: JudgeInput) => JudgeResult;

/**
 * judge가 받을 수 있는 시설 정보. Venue에 엔진에서만 쓰는 필드를 더한 것이다.
 * - lastEntryByDay: 요일별 입장 마감. 있으면 그 요일은 venue.lastEntry 대신 이 값을 쓴다.
 * - basis: 이 시설 정보가 어디서 왔는지. 판정 결과의 basis로 그대로 나간다.
 */
export type ResolvedVenue = Venue & {
  lastEntryByDay?: Partial<Record<Weekday, string>>;
  basis?: 'venue' | 'exhibition' | 'merged';
};

/** 'YYYY-MM-DD' 형식이고 달력에 실제 있는 날짜인지 본다. (2026-02-30은 거부) */
function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  // 없는 날짜는 Date가 다음 달로 넘기므로 0일을 더해 되돌린 값이 원래와 같아야 한다
  return addDays(date, 0) === date;
}

export const judge: JudgeFn = (input) => {
  const { exhibition, date, stayStart, stayEnd, holidays } = input;
  const venue = input.venue as ResolvedVenue;
  const basis = venue.basis ?? 'venue';
  const reasons: string[] = [];
  const missing: string[] = [];

  // 0) 입력 검사: 날짜·시각 형식이 틀리거나 머무는 끝이 시작보다 늦지 않으면 판정하지 않는다
  const sStart = toMinutes(stayStart);
  const end = toMinutes(stayEnd);
  if (!isValidDate(date) || sStart === null || end === null || end <= sStart) {
    return { result: 'unknown', reasons: [REASONS.INVALID_INPUT], basis };
  }

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
    const vOpen = toMinutes(op.open);
    const close = toMinutes(op.close);
    const d = venue.visitMinutes ?? DEFAULT_VISIT_MINUTES;

    if (vOpen === null || close === null) {
      missing.push(REASONS.MISSING_HOURS);
    } else {
      const s = Math.max(sStart, vOpen);

      // 요일별 입장 마감이 있으면 그 값, 없으면 시설 전체 값
      const rawLastEntry = venue.lastEntryByDay?.[weekdayOf(date)] ?? op.lastEntry;
      const rawLe = rawLastEntry ? toMinutes(rawLastEntry) : null;

      if (rawLe === null) {
        missing.push(REASONS.MISSING_LAST_ENTRY);
      } else {
        // 입장 마감이 그날 폐관보다 늦게 적혀 있으면 폐관 시각까지만 입장할 수 있다
        const le = Math.min(rawLe, close);
        if (s > le) {
          reasons.push(REASONS.AFTER_LAST_ENTRY(fromMinutes(le)));
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
        return { result: 'impossible', reasons, basis };
      }
      // 위반은 없고 정보만 부족하면 확인 필요
      if (missing.length > 0) {
        return { result: 'unknown', reasons: missing, basis };
      }

      // 모든 조건을 통과한 경우
      return {
        result: 'possible',
        reasons: [],
        entryTime: fromMinutes(s),
        endTime: fromMinutes(s + d),
        slackMinutes: Math.min(close, end) - (s + d),
        basis,
      };
    }
  }

  // op.status가 closed/unknown이거나 시설 시각 형식 오류인 경우
  if (reasons.length > 0) {
    return { result: 'impossible', reasons, basis };
  }
  if (missing.length > 0) {
    return { result: 'unknown', reasons: missing, basis };
  }

  return { result: 'unknown', reasons: [REASONS.MISSING_HOURS], basis };
};
