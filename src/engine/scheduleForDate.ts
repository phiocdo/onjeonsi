import type { DaySchedule, ParsedOperatingHours } from '../types';
import { weekdayOf } from './time';

/** 그날 일정을 어디서 골랐는지. */
export type DayScheduleSource = 'exception' | 'period' | 'weekday' | 'holiday';

export interface PickedDaySchedule {
  schedule: DaySchedule;
  source: DayScheduleSource;
  /** weeksOfMonth에 그날의 주가 없어 휴관으로 바꿨으면 true */
  offWeek: boolean;
}

/**
 * 그 달의 몇째 주인지. 1~7일이 1째 주, 8~14일이 2째 주인 방식이다.
 * "1, 3째주 토"를 "그 달 첫째·셋째 토요일"로 읽는다. (달력 주 방식이 아님)
 */
export function weekOfMonth(date: string): number {
  const day = Number(date.slice(8, 10));
  return Math.ceil(day / 7);
}

/**
 * 회차로 운영하는 요일인지. 회차는 시작 시각에 맞춰 가야 해서 아무 때나 들어가는 판정을 할 수 없다.
 * - DaySchedule에 sessions가 있으면 그것만 본다(PR #41에서 생길 예정. 아직 타입에 없다)
 * - 없으면 note에 '회차'가 들어 있는지 본다
 * #41이 머지되면 이 함수만 sessions를 보도록 바꾼다.
 */
export function isSessionDay(day: DaySchedule): boolean {
  const sessions = (day as DaySchedule & { sessions?: unknown }).sessions;
  if (sessions !== undefined && sessions !== null) {
    return Array.isArray(sessions) ? sessions.length > 0 : Boolean(sessions);
  }
  return day.note?.includes('회차') ?? false;
}

/**
 * scheduleForDate와 같지만 어디서 골랐는지, 몇째 주 규칙으로 닫았는지도 돌려준다.
 * resolveSchedule이 "확실한 휴관"과 "모름"을 나눌 때 쓴다.
 */
export function pickDaySchedule(
  hours: ParsedOperatingHours,
  date: string,
  holidays: string[],
): PickedDaySchedule | null {
  if (hours.scheduleType !== 'scheduled') return null;

  // ① 특정 날짜 예외가 가장 우선이다. 공휴일·몇째 주 규칙도 적용하지 않는다
  const exception = hours.exceptions?.find((e) => e.date === date);
  if (exception) return { schedule: exception.schedule, source: 'exception', offWeek: false };

  const wd = weekdayOf(date);

  // ② 기간이 맞는 periods 중 from이 가장 늦은 것. from이 없으면 가장 이른 것으로 본다
  let picked: { weekdays: ParsedOperatingHours['weekdays']; from: string } | null = null;
  for (const p of hours.periods ?? []) {
    if (p.from !== undefined && p.from > date) continue;
    if (p.to !== undefined && date > p.to) continue;
    const from = p.from ?? '';
    if (picked === null || from > picked.from) picked = { weekdays: p.weekdays, from };
  }
  // ③ 없으면 기본 요일 일정
  const weekdays = picked ? picked.weekdays : hours.weekdays;
  const day = weekdays?.[wd];
  if (!day) return null;

  // ④ 공휴일 규칙이 따로 적혀 있으면 그것
  if (hours.holiday && holidays.includes(date)) {
    return { schedule: hours.holiday, source: 'holiday', offWeek: false };
  }

  const source: DayScheduleSource = picked ? 'period' : 'weekday';
  // ⑤ 몇째 주에만 하는 요일이면 그 주가 아닐 때 휴관
  if (day.weeksOfMonth && day.weeksOfMonth.length > 0 && !day.weeksOfMonth.includes(weekOfMonth(date))) {
    return { schedule: { ...day, isOpen: false, intervals: [] }, source, offWeek: true };
  }
  return { schedule: day, source, offWeek: false };
}

/**
 * 판정 날짜(YYYY-MM-DD)에 적용할 전시 일정을 고른다. null이면 모른다는 뜻이다.
 *
 * - scheduleType이 'scheduled'가 아니면 null (always_open은 resolveSchedule처럼 쓰지 않는다)
 * - 우선순위
 *   ① exceptions에 그 날짜가 있으면 그 일정 (아래 ④⑤를 적용하지 않는다)
 *   ② periods 중 from <= date <= to(없는 쪽은 열림)인 것 가운데 from이 가장 늦은 것의 요일 일정
 *   ③ 기본 weekdays
 *   ④ 그 날짜가 공휴일이고 holiday가 null이 아니면 holiday 일정
 *   ⑤ 고른 요일 일정에 weeksOfMonth가 있고 그날의 주(1~7일 = 1째 주)가 없으면 휴관
 *      (isOpen: false, intervals: [])
 * 입력은 바꾸지 않는다. 돌려준 객체는 입력의 것을 그대로 쓸 수 있으니 고치지 않는다.
 */
export function scheduleForDate(
  hours: ParsedOperatingHours,
  date: string,
  holidays: string[],
): DaySchedule | null {
  return pickDaySchedule(hours, date, holidays)?.schedule ?? null;
}
