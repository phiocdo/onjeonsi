/**
 * "지금부터 2시간" 판정 구간. 내 주변 화면의 첫 시간 선택값과 북마크(패널·모아보기)가 같이 쓴다.
 * 그래서 같은 시각이면 두 화면이 같은 조건으로 판정한다.
 */
import type { CatalogQuery } from './catalog';

/** 판정 구간 길이(분) */
export const GLANCE_MINUTES = 120;
/** 내 주변 시간 선택기(10분 단위)로 고를 수 있는 마지막 시각 */
export const GLANCE_LAST = '23:50';

const LAST = 23 * 60 + 50;

function hhmm(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * 'HH:MM' 시각의 판정 구간.
 * - start: 10분 단위로 내린 시각
 * - end: start + 2시간, 23:50을 넘지 않는다
 * - 23:50 이후(end <= start)는 23:40~23:50으로 둔다
 * 올바른 'HH:MM'이면 결과는 항상 start < end이고 둘 다 10분 단위다.
 * 형식을 검사하지 않는다(예전 glanceQuery와 같다): 숫자로 못 읽으면 'NaN:NaN'이 나오고, 판정 엔진이 시간 형식 오류로 처리한다.
 */
export function glanceWindow(time: string): { start: string; end: string } {
  const [h, m] = time.split(':').map(Number);
  let start = Math.min(h * 60 + Math.floor(m / 10) * 10, LAST);
  let end = Math.min(start + GLANCE_MINUTES, LAST);
  if (end <= start) {
    start = LAST - 10;
    end = LAST;
  }
  return { start: hhmm(start), end: hhmm(end) };
}

/** 그 날짜·시각의 판정 조건 (glanceWindow 구간) */
export function glanceQuery(date: string, time: string): CatalogQuery {
  const { start, end } = glanceWindow(time);
  return { date, stayStart: start, stayEnd: end };
}
