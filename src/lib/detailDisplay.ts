/**
 * 전시 상세 창 표시용 순수 함수.
 * 입장 마감은 판정과 같은 데이터(venueForDate: 판정 날짜에 judge가 받는 시설)와
 * 같은 규칙(dayWindows)으로 읽어, 판정 사유의 "입장 마감(HH:MM)"과 항상 같은 시각을 보인다.
 */
import type { JudgeResult, Weekday } from '../types';
import { dayWindows, type ResolvedVenue } from '../engine/judge';
import { effectiveWeekday, isOpen } from '../engine/isOpen';
import { venueForDate } from '../engine/resolveSchedule';
import { fromMinutes, toMinutes } from '../engine/time';
import { basisLabel, judgeEntry, type CatalogEntry, type CatalogQuery } from './catalog';
import { similarExhibitions } from './similar';

const EMPTY = '정보 없음';
const ASSUMED = '정보 없음 (폐관 시각 기준으로 판정)';
const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** 구간 하나의 입장 마감. 'assumed'는 값이 없어 폐관 기준, 'invalid'는 형식 오류(MISSING_LAST_ENTRY). */
type DayEntry = { kind: 'time'; time: string; close: number } | { kind: 'assumed' } | { kind: 'invalid' };

/** 그 요일 구간별 입장 마감. 폐관보다 늦은 값은 판정(checkWindow)처럼 폐관 시각으로 줄인다. */
function entriesFor(venue: ResolvedVenue, wd: Weekday): DayEntry[] {
  return dayWindows(venue, wd).map((w): DayEntry => {
    if (w.lastEntry === undefined) return { kind: 'assumed' };
    const le = toMinutes(w.lastEntry);
    const close = toMinutes(w.close);
    if (le === null || close === null) return { kind: 'invalid' };
    return { kind: 'time', time: fromMinutes(Math.min(le, close)), close };
  });
}

function keyOf(list: DayEntry[]): string {
  return list.map((e) => (e.kind === 'time' ? e.time : e.kind)).join('/');
}

/** 60 → '1시간', 90 → '1시간 30분', 30 → '30분' */
function duration(n: number): string {
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (h && m) return `${h}시간 ${m}분`;
  return h ? `${h}시간` : `${m}분`;
}

/**
 * 입장 마감 표시 문구. venue는 판정 날짜에 judge가 받는 시설(venueForDate)이어야 한다.
 * - 판정용 시설 없음·그날 운영 시간 없음 → '정보 없음'
 * - 그날 휴관 → '오늘 휴관'
 * - 정보가 없어 폐관 기준으로 판정 → '정보 없음 (폐관 시각 기준으로 판정)'
 * - 폐관 − N 규칙(lastEntryBeforeClose)과 값이 맞으면 기준을 함께: 요일마다 같으면
 *   '폐관 1시간 전 (17:00)', 요일별로 다르면 '오늘 17:00 (폐관 1시간 전)'.
 *   N이 0이면 '폐관 N분 전' 대신 '폐관 시각까지': '폐관 시각까지 (18:00)', '오늘 21:00 (폐관 시각까지)'
 * - 그 밖(lastEntry 고정·전시 안내)은 시각만: 요일마다 같으면 '17:00', 다르면 '오늘 17:00'
 * 구간이 여러 개인 날은 구간별 값을 ' / '로 잇는다. day는 '오늘' 자리에 들어갈 말이다.
 */
export function lastEntryLabel(venue: ResolvedVenue | null, date: string, holidays: string[], day = '오늘'): string {
  if (!venue) return EMPTY;
  const op = isOpen(venue, date, holidays);
  if (op.status === 'closed') return `${day} 휴관`;
  if (op.status === 'unknown') return EMPTY;

  const wd = effectiveWeekday(venue, date, holidays);
  const today = entriesFor(venue, wd);
  if (today.length === 0) return EMPTY;
  if (today.every((e) => e.kind === 'assumed')) return ASSUMED;
  if (today.some((e) => e.kind === 'invalid')) return `${EMPTY} (형식 오류)`;

  const times = today.map((e) => (e.kind === 'time' ? e.time : '폐관 기준')).join(' / ');
  const n = venue.lastEntryBeforeClose;
  const byRule =
    typeof n === 'number' && Number.isFinite(n) && n >= 0 &&
    today.every((e) => e.kind === 'time' && e.time === fromMinutes(Math.max(0, e.close - Math.round(n))));
  const rule = !byRule ? null : Math.round(n) === 0 ? '폐관 시각까지' : `폐관 ${duration(Math.round(n))} 전`;

  const key = keyOf(today);
  const uniform = WEEKDAYS.filter((d) => venue.hours?.[d]).every((d) => keyOf(entriesFor(venue, d)) === key);

  if (uniform) return rule ? `${rule} (${times})` : times;
  return rule ? `${day} ${times} (${rule})` : `${day} ${times}`;
}

/** 카탈로그 항목의 그 날짜 입장 마감 표시. 판정(judgeEntry)과 같은 근거(resolved)로 계산한다. */
export function entryLastEntryLabel(entry: CatalogEntry, date: string, holidays: string[], day = '오늘'): string {
  const venue = venueForDate({ exhibition: entry.exhibition, date, holidays }, entry.resolved);
  return lastEntryLabel(venue, date, holidays, day);
}

/**
 * 상세 창을 열 때 넘기는 판정 조건. 넘긴 판정(judge)을 계산한 조건과 같아야 한다.
 * stayStart/stayEnd가 없으면 detailQuery의 기본 규칙으로 채운다.
 */
export interface DetailCondition {
  date: string;
  stayStart?: string;
  stayEnd?: string;
}

/** 상세 창 기본 머물 끝 시각 */
const DAY_END = '23:59';

/**
 * 상세 창 판정 조건을 정한다. 상세 창의 판정·입장 마감·비슷한 전시 카드가 모두 이 결과를 쓴다.
 * - 조건 없음 → 오늘(now.date) 지금(now.time) ~ 23:59
 * - 날짜만 있음 → 그 날짜, 시각은 상세 창 기존 기본값(지금 ~ 23:59). 오늘이든 다른 날이든 같다
 * - stayStart/stayEnd가 있으면 그 값을 그대로 쓴다
 * now는 서울 기준 { date: YYYY-MM-DD, time: HH:MM }.
 */
export function detailQuery(cond: DetailCondition | null | undefined, now: { date: string; time: string }): CatalogQuery {
  return {
    date: cond?.date ?? now.date,
    stayStart: cond?.stayStart ?? now.time,
    stayEnd: cond?.stayEnd ?? DAY_END,
  };
}

/**
 * 비슷한 전시 카드와 그 판정. 후보(진행 중 여부)와 판정 모두 상세 창과 같은 조건(query)으로 계산한다.
 * 카드를 누를 때 judge와 query를 함께 넘기면 다음 상세 창도 같은 기준을 유지한다.
 */
export function similarWithJudge(
  target: CatalogEntry,
  catalog: readonly CatalogEntry[],
  query: CatalogQuery,
  holidays: string[],
): { entry: CatalogEntry; judge: JudgeResult }[] {
  return similarExhibitions(target, catalog, { today: query.date }).map((entry) => ({
    entry,
    judge: judgeEntry(entry, query, holidays),
  }));
}

/**
 * 판정 사유를 줄 단위로 나눈다. 근거 문구(· 시설·전시 안내 기준)는 마지막 줄에 한 번만 붙인다.
 * 사유가 없으면 근거 문구 한 줄(근거도 없으면 []).
 */
export function reasonLines(judge: Pick<JudgeResult, 'reasons' | 'basis'>): string[] {
  const basis = basisLabel(judge.basis);
  const lines = judge.reasons.filter(Boolean);
  if (!basis) return lines;
  if (lines.length === 0) return [basis];
  return [...lines.slice(0, -1), `${lines[lines.length - 1]} · ${basis}`];
}
