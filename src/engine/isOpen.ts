import type { Venue, Weekday } from '../types';
import { REASONS } from './reasons';
import { addDays, fromMinutes, toMinutes, weekdayOf } from './time';

export type OpenStatus =
  | { status: 'open'; open: string; close: string; lastEntry?: string }
  | { status: 'closed'; reason: string }
  | { status: 'unknown'; reason: string };

const WEEKDAY_LABEL: Record<Weekday, string> = {
  mon: '월',
  tue: '화',
  wed: '수',
  thu: '목',
  fri: '금',
  sat: '토',
  sun: '일',
};

/**
 * 판정에 쓸 요일. 그날이 공휴일이고 holidayAs가 있으면 그 요일, 아니면 실제 요일이다.
 * 운영시간·구간·입장 마감을 이 요일로 읽는다. 휴관 여부는 실제 요일로 본다(isOpen).
 */
export function effectiveWeekday(venue: Venue, date: string, holidays: string[]): Weekday {
  if (venue.holidayAs && holidays.includes(date)) return venue.holidayAs;
  return weekdayOf(date);
}

/**
 * 시설 기준 그 요일의 입장 마감(HH:MM).
 * - lastEntryBeforeClose가 있으면 hours[weekday].close − N분. 폐관 시각을 읽을 수 없으면 lastEntry
 *   - N이 0 이상의 수가 아니면 ''(형식 오류 → judge에서 MISSING_LAST_ENTRY)
 *   - open보다 이르더라도 그대로 둔다(판정이 자연스럽게 불가가 된다). 00:00보다 이르면 00:00
 * - 없으면 lastEntry (없으면 undefined → 폐관 기준)
 */
export function venueLastEntry(venue: Venue, weekday: Weekday): string | undefined {
  const n = venue.lastEntryBeforeClose;
  if (n === undefined) return venue.lastEntry;
  const close = toMinutes(venue.hours?.[weekday]?.close ?? '');
  if (close === null) return venue.lastEntry;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '';
  return fromMinutes(Math.max(0, close - Math.round(n)));
}

/**
 * 시설이 그 날(date, 'YYYY-MM-DD') 문을 여는지 판정한다. 먼저 걸리는 규칙이 이긴다.
 * 1) 지정 휴관일(dates: 'YYYY-MM-DD' 또는 매년 'MM-DD'). 공휴일이어도 휴관
 * 2) 정기 휴관 요일 (공휴일이고 ifHoliday가 'nextDay' 또는 'open'이면 개관)
 * 3) 공휴일과 겹쳐 하루 밀린 휴관일 (ifHoliday가 'nextDay'일 때만)
 * 4) 판정에 쓸 요일(effectiveWeekday: 공휴일이면 holidayAs)의 운영 시간. 없으면 unknown
 * 돌려주는 lastEntry는 시설 전체 lastEntry 그대로다. 그날 입장 마감은 venueLastEntry로 구한다.
 */
export function isOpen(venue: Venue, date: string, holidays: string[]): OpenStatus {
  const closed = venue.closed;
  const closedWeekday = closed?.weekday;
  const shiftToNextDay = closed?.ifHoliday === 'nextDay';
  const openOnHoliday = shiftToNextDay || closed?.ifHoliday === 'open';
  const weekday = weekdayOf(date);

  const dates = closed?.dates;
  if (dates && (dates.includes(date) || dates.includes(date.slice(5)))) {
    return { status: 'closed', reason: REASONS.CLOSED_DATE };
  }

  if (closedWeekday && weekday === closedWeekday) {
    const openBecauseHoliday = openOnHoliday && holidays.includes(date);
    if (!openBecauseHoliday) {
      return { status: 'closed', reason: REASONS.CLOSED_WEEKDAY(WEEKDAY_LABEL[weekday]) };
    }
  }

  if (closedWeekday && shiftToNextDay) {
    const prev = addDays(date, -1);
    if (holidays.includes(prev) && weekdayOf(prev) === closedWeekday) {
      return { status: 'closed', reason: REASONS.CLOSED_HOLIDAY };
    }
  }

  const hours = venue.hours?.[effectiveWeekday(venue, date, holidays)];
  if (!hours) {
    return { status: 'unknown', reason: REASONS.MISSING_HOURS };
  }

  return { status: 'open', open: hours.open, close: hours.close, lastEntry: venue.lastEntry };
}
