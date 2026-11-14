import type { Venue, Weekday } from '../types';
import { REASONS } from './reasons';
import { addDays, weekdayOf } from './time';

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
 * 시설이 그 날(date, 'YYYY-MM-DD') 문을 여는지 판정한다. 먼저 걸리는 규칙이 이긴다.
 * 1) 지정 휴관일(dates: 'YYYY-MM-DD' 또는 매년 'MM-DD')
 * 2) 정기 휴관 요일 (공휴일이고 ifHoliday가 'nextDay'면 개관)
 * 3) 공휴일과 겹쳐 하루 밀린 휴관일
 * 4) 그 요일 운영 시간이 없으면 unknown
 */
export function isOpen(venue: Venue, date: string, holidays: string[]): OpenStatus {
  const closed = venue.closed;
  const closedWeekday = closed?.weekday;
  const shiftToNextDay = closed?.ifHoliday === 'nextDay';
  const weekday = weekdayOf(date);

  const dates = closed?.dates;
  if (dates && (dates.includes(date) || dates.includes(date.slice(5)))) {
    return { status: 'closed', reason: REASONS.CLOSED_DATE };
  }

  if (closedWeekday && weekday === closedWeekday) {
    const openBecauseHoliday = shiftToNextDay && holidays.includes(date);
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

  const hours = venue.hours?.[weekday];
  if (!hours) {
    return { status: 'unknown', reason: REASONS.MISSING_HOURS };
  }

  return { status: 'open', open: hours.open, close: hours.close, lastEntry: venue.lastEntry };
}
