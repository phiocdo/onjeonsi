import type { Weekday } from '../types';

/** Date.getDay() 순서(0=일요일)에 맞춘 요일 키. */
const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 'YYYY-MM-DD'를 숫자로 쪼갠다. 문자열을 Date에 바로 넣으면 UTC로 해석되므로 쓰지 않는다. */
function splitDate(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y, m, d];
}

/** 'HH:MM'(00:00~23:59) → 0시부터 지난 분. 형식이 맞지 않으면 null. */
export function toMinutes(hhmm: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** 분 → 'HH:MM' (두 자리 0 채움). */
export function fromMinutes(n: number): string {
  return `${pad2(Math.floor(n / 60))}:${pad2(n % 60)}`;
}

/** 'YYYY-MM-DD'의 요일. 로컬 날짜로 계산한다. */
export function weekdayOf(date: string): Weekday {
  const [y, m, d] = splitDate(date);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}

/** 'YYYY-MM-DD'에 n일을 더한 날짜를 같은 형식으로 돌려준다. 월·연 경계는 Date가 넘겨 준다. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = splitDate(date);
  const next = new Date(y, m - 1, d + n);
  return `${next.getFullYear()}-${pad2(next.getMonth() + 1)}-${pad2(next.getDate())}`;
}
