/**
 * 관람 날짜가 전시 기간·오늘 기준으로 맞는지 판단하는 순수 함수.
 *
 * - 기록 입력 화면(Archive.tsx)과 공유 전송(shareSync.ts planShareSync)이 같은 visitDateProblem을 쓴다.
 * - 날짜는 'YYYY-MM-DD' 문자열. 오늘은 호출하는 쪽이 서울 기준(todayInSeoul)으로 넘긴다.
 * - 기간 정보가 없는 쪽(start나 end가 비었음)은 그쪽 경계를 검사하지 않는다.
 * - 시작일·종료일·오늘 당일은 허용한다.
 */
import { isCalendarDate } from './archive';

export interface VisitPeriod {
  start?: string | null;
  end?: string | null;
}

export type VisitDateProblemCode = 'BEFORE_START' | 'AFTER_END' | 'FUTURE' | 'INVALID_DATE';

export interface VisitDateProblem {
  code: VisitDateProblemCode;
  message: string;
}

export interface VisitDateOptions {
  // false면 FUTURE(오늘 이후) 검사를 하지 않는다. 공유 전송에서 시계 차이로 정상 기록이 빠지지 않게 할 때 쓴다
  checkFuture?: boolean;
}

/** 기간 경계 값. 달력 날짜가 아니면(빈 값 포함) 없는 것으로 본다 */
function bound(v: string | null | undefined): string | undefined {
  return isCalendarDate(v) ? v : undefined;
}

/** '2026-12-21' → '12/21' */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}/${d}`;
}

/** '2026-12-21' → '12월 21일' */
function longDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}월 ${d}일`;
}

/** '(12/21~12/29)'. 한쪽이 없으면 '(12/21~)' 또는 '(~12/29)' */
function periodText(start: string | undefined, end: string | undefined): string {
  return `(${start ? shortDate(start) : ''}~${end ? shortDate(end) : ''})`;
}

/**
 * 관람 날짜의 문제. 없으면 null.
 * 검사 순서: INVALID_DATE → FUTURE → BEFORE_START → AFTER_END
 */
export function visitDateProblem(
  date: string,
  period: VisitPeriod,
  today: string,
  { checkFuture = true }: VisitDateOptions = {},
): VisitDateProblem | null {
  if (!isCalendarDate(date)) return { code: 'INVALID_DATE', message: '날짜를 다시 확인해 주세요.' };
  if (checkFuture && date > today) {
    return { code: 'FUTURE', message: '아직 오지 않은 날짜예요. 다녀온 뒤에 기록해 주세요.' };
  }
  const start = bound(period.start);
  const end = bound(period.end);
  const range = periodText(start, end);
  if (start && date < start) {
    return { code: 'BEFORE_START', message: `이 전시는 ${longDate(start)}에 시작해요. 전시 기간${range} 안의 날짜를 골라 주세요.` };
  }
  if (end && date > end) {
    return { code: 'AFTER_END', message: `이 전시는 ${longDate(end)}에 끝났어요. 전시 기간${range} 안의 날짜를 골라 주세요.` };
  }
  return null;
}

export interface VisitRange {
  min?: string;
  max: string;
  // 고를 수 있는 날이 없음 (시작일이 오늘 이후이거나, 기간 정보가 거꾸로 됨)
  empty: boolean;
}

/** 날짜 입력 칸의 min/max. max = min(end, today) */
export function allowedVisitRange(period: VisitPeriod, today: string): VisitRange {
  const start = bound(period.start);
  const end = bound(period.end);
  const max = end && end < today ? end : today;
  return { ...(start ? { min: start } : {}), max, empty: start !== undefined && start > max };
}

/**
 * 입력 폼에 보여 줄 문구. 저장할 수 있으면 null.
 * 아직 시작 전인 전시는 날짜와 상관없이 기록할 수 없으므로 그 사실을 먼저 알린다.
 */
export function visitFormNotice(date: string, period: VisitPeriod, today: string): string | null {
  const start = bound(period.start);
  if (start && start > today) return `이 전시는 아직 시작 전이라 기록할 수 없어요 (${shortDate(start)} 시작).`;
  return visitDateProblem(date, period, today)?.message ?? null;
}

/** 공유해도 되는 관람 날짜인지. 전시 기간 밖(BEFORE_START·AFTER_END)만 뺀다(FUTURE는 보지 않는다) */
export function isShareableVisitDate(date: string, period: VisitPeriod, today: string): boolean {
  const problem = visitDateProblem(date, period, today, { checkFuture: false });
  return problem?.code !== 'BEFORE_START' && problem?.code !== 'AFTER_END';
}
