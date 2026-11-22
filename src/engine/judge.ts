import type { JudgeInput, JudgeResult, Venue, Weekday } from '../types';
import { effectiveWeekday, isOpen, venueLastEntry } from './isOpen';
import { toMinutes, fromMinutes, addDays } from './time';
import { REASONS } from './reasons';
import { DEFAULT_VISIT_MINUTES } from './constants';

export type JudgeFn = (input: JudgeInput) => JudgeResult;

/** 하루 안의 한 운영 구간. lastEntry는 그 구간의 입장 마감(없으면 시설 lastEntry를 쓴다). */
export interface ResolvedInterval {
  open: string;
  close: string;
  lastEntry?: string;
}

/**
 * judge가 받을 수 있는 시설 정보. Venue에 엔진에서만 쓰는 필드를 더한 것이다.
 * - lastEntryByDay: 요일별 입장 마감(resolveSchedule이 전시 근거로 만든다). 있으면 그 요일은
 *   lastEntryBeforeClose·lastEntry 대신 이 값을 쓴다.
 * - intervalsByDay: 하루에 구간이 여러 개인 요일(점심 휴관 등). 있으면 그 요일은 hours 대신
 *   이 구간들로 판정한다. hours에는 첫 구간 시작 ~ 마지막 구간 끝이 들어 있다.
 * - basis: 이 시설 정보가 어디서 왔는지. 판정 결과의 basis로 그대로 나간다.
 */
export type ResolvedVenue = Venue & {
  lastEntryByDay?: Partial<Record<Weekday, string>>;
  intervalsByDay?: Partial<Record<Weekday, ResolvedInterval[]>>;
  basis?: 'venue' | 'exhibition' | 'merged';
};

/** 'YYYY-MM-DD' 형식이고 달력에 실제 있는 날짜인지 본다. (2026-02-30은 거부) */
export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  // 없는 날짜는 Date가 다음 달로 넘기므로 0일을 더해 되돌린 값이 원래와 같아야 한다
  return addDays(date, 0) === date;
}

/** precheck 결과. 입력이 맞으면 머무는 시각(분)과 전시 기간 밖인지를 함께 돌려준다. */
export type Precheck =
  | { valid: false }
  | { valid: true; sStart: number; end: number; outOfPeriod: boolean };

/**
 * 시설 정보 없이 할 수 있는 검사. judge와 judgeResolved(시설 없음)가 같은 규칙을 쓰도록 여기서만 정의한다.
 * - 입력 검사: 날짜·시각 형식이 틀리거나 머무는 끝이 시작보다 늦지 않으면 valid: false (→ INVALID_INPUT)
 * - 전시 기간 검사: date가 exhibition.start ~ end 밖이면 outOfPeriod: true (→ OUT_OF_PERIOD)
 */
export function precheck(input: Pick<JudgeInput, 'exhibition' | 'date' | 'stayStart' | 'stayEnd'>): Precheck {
  const { exhibition, date } = input;
  const sStart = toMinutes(input.stayStart);
  const end = toMinutes(input.stayEnd);
  if (!isValidDate(date) || sStart === null || end === null || end <= sStart) return { valid: false };
  return { valid: true, sStart, end, outOfPeriod: date < exhibition.start || date > exhibition.end };
}

/**
 * 판정에 쓸 요일(wd)의 운영 구간과 구간별 입장 마감(가공 전 값). judge와 화면 표시가 같이 쓴다.
 * 구간이 여러 개인 요일은 intervalsByDay, 아니면 hours[wd] 하나. hours[wd]가 없으면 [].
 * 입장 마감: lastEntryByDay[wd](전시 근거) > 그날 폐관 − N(lastEntryBeforeClose) > lastEntry > 없음(undefined → 폐관 기준)
 * 값이 ''이면 형식 오류(MISSING_LAST_ENTRY)다. 폐관보다 늦은 값은 checkWindow가 폐관 시각으로 줄인다.
 */
export function dayWindows(venue: ResolvedVenue, wd: Weekday): ResolvedInterval[] {
  const hours = venue.hours?.[wd];
  if (!hours) return [];
  const dayLastEntry = venueLastEntry(venue, wd);
  const multi = venue.intervalsByDay?.[wd];
  return multi && multi.length > 0
    ? multi.map((iv) => ({ ...iv, lastEntry: iv.lastEntry ?? dayLastEntry }))
    : [{ open: hours.open, close: hours.close, lastEntry: venue.lastEntryByDay?.[wd] ?? dayLastEntry }];
}

/** 구간 하나를 판정한 결과. */
interface WindowCheck {
  violations: string[];
  missing: string[];
  s: number;
  d: number;
  close: number;
  /** 입장 마감이 없어 폐관 시각을 입장 마감으로 썼는지 */
  assumed: boolean;
  /** 가능에서 얼마나 모자랐는지(분). 불가일 때 "가장 가까운 구간"을 고르는 데 쓴다 */
  shortfall: number;
}

/** 머무는 시간(sStart~end)과 관람 시간(d)으로 구간 하나를 판정한다. */
function checkWindow(
  open: number,
  close: number,
  rawLastEntry: string | undefined,
  sStart: number,
  end: number,
  d: number,
): WindowCheck {
  const violations: string[] = [];
  const missing: string[] = [];
  const s = Math.max(sStart, open);

  // 입장 마감이 아예 없으면 폐관 시각을 입장 마감으로 본다. 이때 s > le면 s + d > close도
  // 성립하므로 AFTER_LAST_ENTRY는 내지 않는다(실제 입장 마감이 아닌 시각을 문구에 넣지 않는다).
  // 값은 있는데 형식이 틀리면 지금처럼 MISSING_LAST_ENTRY다.
  const assumed = rawLastEntry === undefined;
  let le = close;
  if (!assumed) {
    const rawLe = toMinutes(rawLastEntry);
    if (rawLe === null) {
      missing.push(REASONS.MISSING_LAST_ENTRY);
    } else {
      // 입장 마감이 그날 폐관보다 늦게 적혀 있으면 폐관 시각까지만 입장할 수 있다
      le = Math.min(rawLe, close);
      if (s > le) violations.push(REASONS.AFTER_LAST_ENTRY(fromMinutes(le)));
    }
  }

  if (s + d > close) violations.push(REASONS.NOT_ENOUGH_BEFORE_CLOSE);
  if (s + d > end) violations.push(REASONS.NOT_ENOUGH_STAY);

  const shortfall = Math.max(0, s - le) + Math.max(0, s + d - Math.min(close, end));
  return { violations, missing, s, d, close, assumed, shortfall };
}

export const judge: JudgeFn = (input) => {
  const { date, holidays } = input;
  const venue = input.venue as ResolvedVenue;
  const basis = venue.basis ?? 'venue';
  const reasons: string[] = [];

  // 0) 입력 검사: 날짜·시각 형식이 틀리거나 머무는 끝이 시작보다 늦지 않으면 판정하지 않는다
  const pre = precheck(input);
  if (!pre.valid) {
    return { result: 'unknown', reasons: [REASONS.INVALID_INPUT], basis };
  }
  const { sStart, end } = pre;

  // 1) 전시 기간 판정
  if (pre.outOfPeriod) {
    reasons.push(REASONS.OUT_OF_PERIOD);
  }

  // 2) 시설 운영 여부 판정
  const op = isOpen(venue, date, holidays);

  if (op.status === 'closed') {
    reasons.push(op.reason);
    return { result: 'impossible', reasons, basis };
  }
  if (op.status === 'unknown') {
    if (reasons.length > 0) return { result: 'impossible', reasons, basis };
    return { result: 'unknown', reasons: [op.reason], basis };
  }

  // 3) 그날의 운영 구간과 입장 마감(dayWindows). 요일은 판정에 쓸 요일(공휴일이면 holidayAs)이다.
  // op가 open이면 hours[wd]가 있으므로 windows는 비지 않는다(op.open/close == hours[wd]).
  const wd = effectiveWeekday(venue, date, holidays);
  const windows = dayWindows(venue, wd);

  const d = venue.visitMinutes ?? DEFAULT_VISIT_MINUTES;
  const checks: WindowCheck[] = [];
  for (const w of windows) {
    const o = toMinutes(w.open);
    const c = toMinutes(w.close);
    if (o === null || c === null) {
      // 시설 시각 형식 오류
      if (reasons.length > 0) return { result: 'impossible', reasons, basis };
      return { result: 'unknown', reasons: [REASONS.MISSING_HOURS], basis };
    }
    checks.push(checkWindow(o, c, w.lastEntry, sStart, end, d));
  }

  // 판정에 쓸 구간: 가장 이른 가능한 구간 → 위반 없이 정보만 모자란 구간 → 가장 가까웠던 구간
  // (가까움 = 모자란 분이 가장 적은 것, 같으면 이른 구간)
  const best =
    checks.find((c) => c.violations.length === 0 && c.missing.length === 0) ??
    checks.find((c) => c.violations.length === 0) ??
    checks.reduce((a, b) => (b.shortfall < a.shortfall ? b : a));

  reasons.push(...best.violations);

  // 위반 조건이 있으면 불가 우선.
  // 폐관 기준(입장 마감 없음)은 실제 입장 마감보다 느슨하므로 불가 판정은 그 가정과 무관하다.
  // 그래서 lastEntryAssumed는 가능일 때만 넣는다
  if (reasons.length > 0) {
    return { result: 'impossible', reasons, basis };
  }
  // 위반은 없고 정보만 부족하면 확인 필요
  if (best.missing.length > 0) {
    return { result: 'unknown', reasons: best.missing, basis };
  }

  // 모든 조건을 통과한 경우
  return {
    result: 'possible',
    reasons: [],
    entryTime: fromMinutes(best.s),
    endTime: fromMinutes(best.s + best.d),
    slackMinutes: Math.min(best.close, end) - (best.s + best.d),
    basis,
    ...(best.assumed ? { lastEntryAssumed: true as const } : {}),
  };
};
