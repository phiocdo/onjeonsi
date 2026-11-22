import type { DaySchedule, JudgeInput, JudgeResult, ParsedOperatingHours, TimeInterval, Venue, Weekday } from '../types';
import { judge, isValidDate, precheck, type ResolvedInterval, type ResolvedVenue } from './judge';
import { effectiveWeekday, isOpen, venueLastEntry } from './isOpen';
import { isSessionDay, pickDaySchedule } from './scheduleForDate';
import { toMinutes, fromMinutes, weekdayOf } from './time';
import { REASONS } from './reasons';

const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export type ResolveBasis = 'venue' | 'exhibition' | 'merged';

/** 시설 데이터와 전시 운영 시간이 다른 곳. 시설 데이터 점검용이다. */
export interface Mismatch {
  weekday: Weekday;
  kind: 'closed' | 'open' | 'close' | 'lastEntry';
  /** 시설 쪽 값. closed면 'closed', 시설에 값이 없으면 null */
  venueValue: string | null;
  /** 전시 쪽 값. closed면 전시 구간('10:00~18:00', 여러 개면 '10:00~12:00, 13:00~18:00') */
  exhibitionValue: string | null;
}

export interface ResolveResult {
  venue: ResolvedVenue | null;
  basis: ResolveBasis | null;
  mismatches: Mismatch[];
  /**
   * resolveSchedule에 넘긴 원래 값. judgeResolved가 판정 날짜의 일정(scheduleForDate)을
   * 다시 고를 때 쓴다. useExhibitionHours가 true이고 hours가 'scheduled'일 때만 들어간다.
   */
  source?: {
    venue: Venue | null;
    hours: ParsedOperatingHours;
    options: ResolveOptions;
  };
}

export interface ResolveOptions {
  /** true면 전시 운영 시간도 판정에 쓴다. 기본은 false(시설만). */
  useExhibitionHours: boolean;
}

/** 믿을 수 있는 전시 구간 하나. 시각은 분으로 읽어 둔다. */
interface TrustedInterval {
  interval: TimeInterval;
  open: number;
  close: number;
}

/** 믿을 수 있는 요일. 구간은 이른 순이고 겹치지 않는다. */
interface TrustedDay {
  intervals: TrustedInterval[];
}

/** 요일별 전시 정보. 'closed'는 판정 날짜에 확실히 쉬는 경우(날짜 예외·공휴일 휴관·쉬는 주)만. 없으면 "모름". */
type TrustMap = Partial<Record<Weekday, TrustedDay | 'closed'>>;

/**
 * 하루 일정을 믿을 수 있으면 구간들을 돌려준다. 아니면 null("모름").
 * - isOpen: true, 구간이 하나 이상, 각 구간 open < close (둘 다 HH:MM), 구간끼리 겹치지 않음
 * - 회차로 운영하는 요일(isSessionDay)은 믿지 않는다
 * isOpen: false는 해석기가 "모름"과 "휴관"을 구분하지 못해 "모름"으로 본다.
 */
function trustDay(day: DaySchedule | undefined): TrustedDay | null {
  if (!day || day.isOpen !== true || day.intervals.length === 0) return null;
  if (isSessionDay(day)) return null;
  const intervals: TrustedInterval[] = [];
  for (const interval of day.intervals) {
    const open = toMinutes(interval.open);
    const close = toMinutes(interval.close);
    if (open === null || close === null || open >= close) return null;
    intervals.push({ interval: { ...interval }, open, close });
  }
  intervals.sort((a, b) => a.open - b.open);
  for (let i = 1; i < intervals.length; i++) {
    if (intervals[i].open < intervals[i - 1].close) return null;
  }
  return { intervals };
}

/** 전시 운영 시간(기본 요일 일정) 중 "믿을 수 있는 요일"만 고른다. scheduleType이 'scheduled'일 때만 본다. */
function trustedDays(hours: ParsedOperatingHours | undefined): Partial<Record<Weekday, TrustedDay>> {
  const out: Partial<Record<Weekday, TrustedDay>> = {};
  if (!hours || hours.scheduleType !== 'scheduled') return out;
  for (const wd of WEEKDAYS) {
    const t = trustDay(hours.weekdays?.[wd]);
    if (t) out[wd] = t;
  }
  return out;
}

/** 입력 시설을 깊게 복사한다. 결과를 고쳐도 원본이 바뀌지 않게 한다. */
function copyVenue(venue: Venue): Venue {
  const hours: Venue['hours'] = venue.hours ? {} : undefined;
  if (venue.hours && hours) {
    for (const wd of WEEKDAYS) {
      const h = venue.hours[wd];
      if (h) hours[wd] = { ...h };
    }
  }
  return {
    ...venue,
    aliases: [...venue.aliases],
    hours,
    closed: venue.closed
      ? { ...venue.closed, dates: venue.closed.dates ? [...venue.closed.dates] : undefined }
      : undefined,
    docent: venue.docent?.map((d) => ({ days: [...d.days], times: [...d.times] })),
  };
}

/** 읽을 수 있는 값 중 가장 이른 시각. 하나도 없으면 null. */
function minTime(...values: (string | undefined)[]): number | null {
  const mins = values
    .map((v) => (v === undefined ? null : toMinutes(v)))
    .filter((n): n is number => n !== null);
  return mins.length > 0 ? Math.min(...mins) : null;
}

/** 시설과 전시(믿을 수 있는 요일만)의 차이를 모은다. 구간이 여러 개면 첫 구간 시작·마지막 구간 끝과 비교한다. */
function findMismatches(venue: Venue, trusted: Partial<Record<Weekday, TrustedDay>>): Mismatch[] {
  const out: Mismatch[] = [];
  for (const wd of WEEKDAYS) {
    const t = trusted[wd];
    if (!t) continue;
    const first = t.intervals[0].interval;
    const last = t.intervals[t.intervals.length - 1].interval;

    // 시설은 휴관인데 전시는 연다고 적힌 요일
    if (venue.closed?.weekday === wd) {
      out.push({
        weekday: wd,
        kind: 'closed',
        venueValue: 'closed',
        exhibitionValue: t.intervals.map((i) => `${i.interval.open}~${i.interval.close}`).join(', '),
      });
      continue;
    }

    // 시설에 그 요일 시간이 없으면 비교할 수 없다
    const vh = venue.hours?.[wd];
    if (vh) {
      if (vh.open !== first.open) {
        out.push({ weekday: wd, kind: 'open', venueValue: vh.open, exhibitionValue: first.open });
      }
      if (vh.close !== last.close) {
        out.push({ weekday: wd, kind: 'close', venueValue: vh.close, exhibitionValue: last.close });
      }
    }

    // 입장 마감은 전시에 적혀 있을 때만 비교한다. 시설 값은 그 요일 기준(폐관 − N 반영)
    const venueLe = venueLastEntry(venue, wd);
    if (last.lastAdmission !== undefined && venueLe !== last.lastAdmission) {
      out.push({
        weekday: wd,
        kind: 'lastEntry',
        venueValue: venueLe ?? null,
        exhibitionValue: last.lastAdmission,
      });
    }
  }
  return out;
}

/**
 * 요일 하나의 구간들을 hours / lastEntryByDay / intervalsByDay에 넣는다.
 * 구간이 하나면 지금까지처럼 hours와 lastEntryByDay만, 여러 개면 hours에는 첫 시작 ~ 마지막 끝,
 * 구간별 값은 intervalsByDay에 넣는다.
 */
function putDay(
  wd: Weekday,
  list: ResolvedInterval[],
  hours: NonNullable<Venue['hours']>,
  lastEntryByDay: Partial<Record<Weekday, string>>,
  intervalsByDay: Partial<Record<Weekday, ResolvedInterval[]>>,
): void {
  if (list.length === 0) return;
  hours[wd] = { open: list[0].open, close: list[list.length - 1].close };
  if (list.length === 1) {
    if (list[0].lastEntry !== undefined) lastEntryByDay[wd] = list[0].lastEntry;
  } else {
    intervalsByDay[wd] = list;
  }
}

/** 시설이 없을 때 전시 운영 시간만으로 만드는 판정용 시설. */
function venueFromExhibition(trusted: TrustMap): ResolvedVenue {
  const hours: NonNullable<Venue['hours']> = {};
  const lastEntryByDay: Partial<Record<Weekday, string>> = {};
  const intervalsByDay: Partial<Record<Weekday, ResolvedInterval[]>> = {};
  for (const wd of WEEKDAYS) {
    const t = trusted[wd];
    if (!t || t === 'closed') continue;
    const list = t.intervals.map(({ interval, close }) => {
      const out: ResolvedInterval = { open: interval.open, close: interval.close };
      const la = interval.lastAdmission;
      const laMin = la === undefined ? null : toMinutes(la);
      if (la !== undefined && laMin !== null && laMin <= close) out.lastEntry = la;
      return out;
    });
    putDay(wd, list, hours, lastEntryByDay, intervalsByDay);
  }
  // judge는 hours, closed, holidayAs, lastEntry, lastEntryBeforeClose, visitMinutes, lastEntryByDay, intervalsByDay, basis만 읽는다.
  // 나머지는 타입을 채우기 위한 빈 값이다. 이 객체를 지도·목록에 쓰지 않는다.
  const venue: ResolvedVenue = {
    id: '',
    name: '',
    aliases: [],
    gu: '' as Venue['gu'],
    type: '' as Venue['type'],
    lat: NaN,
    lng: NaN,
    representative: false,
    source: 'exhibition',
    verified: '',
    hours,
    lastEntryByDay,
    basis: 'exhibition',
  };
  if (Object.keys(intervalsByDay).length > 0) venue.intervalsByDay = intervalsByDay;
  return venue;
}

/** 시설과 전시가 둘 다 있을 때 요일별로 겹치는 시간을 만든다. 휴관 규칙은 시설 것. */
function mergeVenue(venue: Venue, trusted: TrustMap): ResolvedVenue {
  const base = copyVenue(venue);
  const hours: NonNullable<Venue['hours']> = {};
  const lastEntryByDay: Partial<Record<Weekday, string>> = {};
  const intervalsByDay: Partial<Record<Weekday, ResolvedInterval[]>> = {};

  for (const wd of WEEKDAYS) {
    const vh = base.hours?.[wd];
    if (!vh) continue; // 시설에 없는 요일은 전시가 있어도 넣지 않는다
    const t = trusted[wd];
    const vOpen = toMinutes(vh.open);
    const vClose = toMinutes(vh.close);

    // 전시가 "모름"(또는 그날 확실한 휴관: judgeResolved가 closed.dates로 막는다)이거나
    // 시설 시각을 읽을 수 없으면 시설 시간 그대로 (judge가 판단)
    if (!t || t === 'closed' || vOpen === null || vClose === null) {
      hours[wd] = vh;
      continue;
    }

    // 전시 구간마다 시설 시간과 겹치는 부분만 남긴다. 겹치는 구간이 없으면 그 요일은 뺀다
    const list: ResolvedInterval[] = [];
    for (const { interval, open: eOpen, close: eClose } of t.intervals) {
      const open = Math.max(vOpen, eOpen);
      const close = Math.min(vClose, eClose);
      if (open >= close) continue;
      const out: ResolvedInterval = { open: fromMinutes(open), close: fromMinutes(close) };
      const le = minTime(venueLastEntry(venue, wd), interval.lastAdmission);
      if (le !== null) out.lastEntry = fromMinutes(Math.min(le, close));
      list.push(out);
    }
    putDay(wd, list, hours, lastEntryByDay, intervalsByDay);
  }

  const out: ResolvedVenue = { ...base, hours, lastEntryByDay, basis: 'merged' };
  if (Object.keys(intervalsByDay).length > 0) out.intervalsByDay = intervalsByDay;
  return out;
}

/** 시설과 요일별 전시 정보로 판정용 시설을 만든다. resolveSchedule과 judgeResolved가 같이 쓴다. */
function build(
  venue: Venue | null,
  trusted: TrustMap,
  options: ResolveOptions,
): { venue: ResolvedVenue | null; basis: ResolveBasis | null } {
  const hasTrusted = Object.keys(trusted).length > 0;
  if (venue) {
    if (!options.useExhibitionHours || !hasTrusted) {
      return { venue: { ...copyVenue(venue), basis: 'venue' }, basis: 'venue' };
    }
    return { venue: mergeVenue(venue, trusted), basis: 'merged' };
  }
  if (options.useExhibitionHours && hasTrusted) {
    return { venue: venueFromExhibition(trusted), basis: 'exhibition' };
  }
  return { venue: null, basis: null };
}

/**
 * 시설 정보와 전시 운영 시간으로 판정에 쓸 시설 정보를 만든다.
 * 날짜를 모르므로 기본 요일 일정(weekdays)만 쓴다. 날짜별 일정은 judgeResolved가 적용한다.
 * 입력 venue, hours는 바꾸지 않는다.
 */
export function resolveSchedule(
  venue: Venue | null,
  hours: ParsedOperatingHours | undefined,
  options: ResolveOptions = { useExhibitionHours: false },
): ResolveResult {
  const trusted = trustedDays(hours);
  const mismatches = venue ? findMismatches(venue, trusted) : [];
  const result: ResolveResult = { ...build(venue, trusted, options), mismatches };
  if (options.useExhibitionHours && hours?.scheduleType === 'scheduled') {
    result.source = { venue, hours, options: { ...options } };
  }
  return result;
}

/**
 * 판정 날짜의 전시 일정으로 요일 정보를 바꾼다. 그날 일정은 판정에 쓸 요일(wd) 키에 넣는다.
 * (시설 holidayAs로 공휴일을 다른 요일 시간으로 판정하면 wd는 실제 요일과 다르다)
 * - scheduleForDate가 null(모름)이거나 믿을 수 없는 일정이면 그 요일은 "모름"
 * - 날짜 예외·공휴일 일정이 isOpen: false이거나 쉬는 주(weeksOfMonth)면 확실한 휴관('closed')
 */
function trustForDate(hours: ParsedOperatingHours, date: string, holidays: string[], wd: Weekday): TrustMap {
  const map: TrustMap = { ...trustedDays(hours) };
  delete map[wd];
  const picked = pickDaySchedule(hours, date, holidays);
  if (!picked) return map;
  const definiteClosed =
    picked.offWeek ||
    (picked.schedule.isOpen === false && (picked.source === 'exception' || picked.source === 'holiday'));
  if (definiteClosed) {
    map[wd] = 'closed';
  } else {
    const t = trustDay(picked.schedule);
    if (t) map[wd] = t;
  }
  return map;
}

/** 판정 날짜에 고른 전시 일정이 회차 운영인지. 쉬는 날(몇째 주 규칙으로 닫은 날 포함)은 회차가 아니다. */
function isSessionDate(hours: ParsedOperatingHours, date: string, holidays: string[]): boolean {
  const picked = pickDaySchedule(hours, date, holidays);
  return picked !== null && !picked.offWeek && picked.schedule.isOpen && isSessionDay(picked.schedule);
}

/**
 * 회차 요일 규칙. 판정 날짜가 회차로 운영하는 날이면 judge 결과를
 * - 불가는 그대로 둔다(어긴 조건이 정보 부족보다 우선. 전시 기간 밖(OUT_OF_PERIOD)도 불가라 그대로)
 * - 입력 오류(확인 필요 + INVALID_INPUT)도 그대로 둔다(basis 포함)
 * - 그 밖의 가능·확인 필요는 확인 필요 + SESSION_DAY 하나로 바꾼다. basis는 남긴다
 * 시설이 없을 때는 judge를 거치지 않고 judgeWithoutVenue가 같은 순서로 판정한다.
 */
function applySessionDay(result: JudgeResult): JudgeResult {
  if (result.result === 'impossible') return result;
  if (result.result === 'unknown' && result.reasons.includes(REASONS.INVALID_INPUT)) return result;
  const out: JudgeResult = { result: 'unknown', reasons: [REASONS.SESSION_DAY] };
  if (result.basis !== undefined) out.basis = result.basis;
  return out;
}

/**
 * 전시 운영시간 원문이 공휴일을 언급했는지.
 * - 해석 결과의 holiday가 있으면(해석기가 "공휴일 휴관" 등을 읽음) 언급한 것
 * - 원문(hoursText)에 '공휴일'·'국경일'이 있으면 언급한 것. 해석기는 "공휴일 정상 운영",
 *   "토·공휴일 10:00~17:00" 같은 개관 언급을 holiday에 담지 않으므로 원문을 같이 본다
 * 명절(설·추석)만 적힌 문구는 그 명절 날짜만 exceptions로 정하므로 공휴일 전체의 언급으로 보지 않는다.
 */
function mentionsHoliday(hours: ParsedOperatingHours, hoursText: string | undefined): boolean {
  if (hours.holiday) return true;
  return /공휴일|국경일/.test(hoursText ?? '');
}

/**
 * 공휴일 미안내 규칙. 근거가 전시 문구뿐인 공휴일에 원문이 공휴일을 언급하지 않았으면 judge 결과를
 * - 불가는 그대로 둔다(applySessionDay와 같음)
 * - 입력 오류(확인 필요 + INVALID_INPUT)도 그대로 둔다
 * - 가능은 확인 필요 + HOLIDAY_UNSTATED
 * - 확인 필요(SESSION_DAY 등)는 기존 사유 뒤에 HOLIDAY_UNSTATED를 덧붙인다. basis는 남긴다
 * 회차 요일 규칙(applySessionDay) 다음에 적용하므로, 둘 다 해당하면 [SESSION_DAY, HOLIDAY_UNSTATED]다.
 */
function applyHolidayUnstated(result: JudgeResult): JudgeResult {
  if (result.result === 'impossible') return result;
  if (result.result === 'unknown' && result.reasons.includes(REASONS.INVALID_INPUT)) return result;
  const prev = result.result === 'unknown' ? result.reasons : [];
  const out: JudgeResult = { result: 'unknown', reasons: [...prev, REASONS.HOLIDAY_UNSTATED] };
  if (result.basis !== undefined) out.basis = result.basis;
  return out;
}

/**
 * 판정용 시설이 없을 때의 판정. judge와 같은 순서로 검사한다(규칙은 judge.ts의 precheck).
 * 1) 입력 오류 → 확인 필요 + INVALID_INPUT
 * 2) 전시 기간 밖 → 불가 + OUT_OF_PERIOD (회차 요일이어도)
 * 3) 둘 다 통과하면 확인 필요 + SESSION_DAY(회차 요일) 또는 MISSING_VENUE
 * 시설이 없으므로 basis는 넣지 않는다.
 */
function judgeWithoutVenue(input: Omit<JudgeInput, 'venue'>, sessionDate: boolean): JudgeResult {
  const pre = precheck(input);
  if (!pre.valid) return { result: 'unknown', reasons: [REASONS.INVALID_INPUT] };
  if (pre.outOfPeriod) return { result: 'impossible', reasons: [REASONS.OUT_OF_PERIOD] };
  return { result: 'unknown', reasons: [sessionDate ? REASONS.SESSION_DAY : REASONS.MISSING_VENUE] };
}

/**
 * resolveSchedule 결과로 판정한다.
 *
 * useExhibitionHours가 true였으면 그날 일정(scheduleForDate: 날짜 예외, periods, 공휴일, 몇째 주)을
 * 다시 골라 적용한다. 전시 일정은 input.exhibition.operatingHours를 쓰고, 없으면 resolveSchedule에
 * 넘긴 hours를 쓴다. 플래그가 false면 resolved.venue로 그대로 판정한다.
 *
 * 플래그가 true이고 그날 일정이 회차(sessions: true)면 회차 요일 규칙(applySessionDay)을 적용한다.
 * 플래그가 false면 적용하지 않는다.
 *
 * 플래그가 true이고 근거가 전시 문구뿐(basis 'exhibition')인데 그날이 공휴일이고 원문이 공휴일을
 * 언급하지 않았으면(mentionsHoliday) 공휴일 미안내 규칙(applyHolidayUnstated)을 회차 요일 규칙 다음에
 * 적용한다. 시설 근거가 있는 전시(venue·merged)와 공휴일이 아닌 날은 바뀌지 않는다.
 *
 * 판정용 시설이 없으면(플래그와 무관) judgeWithoutVenue: 입력 검사(INVALID_INPUT) → 전시 기간
 * 검사(불가, OUT_OF_PERIOD)를 먼저 하고, 둘 다 통과했을 때만 확인 필요 + MISSING_VENUE
 * (플래그 on이고 그날이 회차면 SESSION_DAY)를 낸다.
 */
export function judgeResolved(input: Omit<JudgeInput, 'venue'>, resolved: ResolveResult): JudgeResult {
  const dated = datedVenue(input, resolved);
  if (dated) {
    const { hours, basis, venue } = dated;
    const sessionDate = isSessionDate(hours, input.date, input.holidays);
    if (venue === null) return judgeWithoutVenue(input, sessionDate);
    const judged = judge({ ...input, venue });
    const result = sessionDate ? applySessionDay(judged) : judged;
    // 근거가 전시 문구뿐(시설 규칙이 그날을 정하지 않음)인 공휴일에 원문이 공휴일을 언급하지 않았으면
    // 그날 여는지 모른다. 그날만 따로 적힌 날짜 예외(exceptions)가 있으면 안내된 것으로 본다
    const holidayUnstated =
      basis === 'exhibition' &&
      input.holidays.includes(input.date) &&
      !mentionsHoliday(hours, input.exhibition.hoursText) &&
      pickDaySchedule(hours, input.date, input.holidays)?.source !== 'exception';
    return holidayUnstated ? applyHolidayUnstated(result) : result;
  }

  if (resolved.venue === null) return judgeWithoutVenue(input, false);
  return judge({ ...input, venue: resolved.venue });
}

/**
 * judgeResolved가 판정 날짜의 전시 일정으로 다시 만드는 판정용 시설. 그 경로가 아니면 null.
 * (useExhibitionHours가 true, 일정이 'scheduled', 날짜가 올바를 때만)
 */
function datedVenue(
  input: Pick<JudgeInput, 'exhibition' | 'date' | 'holidays'>,
  resolved: ResolveResult,
): { hours: ParsedOperatingHours; basis: ResolveBasis | null; venue: ResolvedVenue | null } | null {
  const src = resolved.source;
  const hours = input.exhibition.operatingHours ?? src?.hours;
  if (!src || !src.options.useExhibitionHours || hours?.scheduleType !== 'scheduled' || !isValidDate(input.date)) {
    return null;
  }
  const wd = src.venue ? effectiveWeekday(src.venue, input.date, input.holidays) : weekdayOf(input.date);
  const trusted = trustForDate(hours, input.date, input.holidays, wd);
  const built = build(src.venue, trusted, src.options);
  let venue = built.venue;
  // 전시가 그날 확실히 쉬면 지정 휴관일로 막는다. 시설이 이미 쉬는 날이면 시설 사유를 그대로 둔다
  if (venue && trusted[wd] === 'closed' && isOpen(venue, input.date, input.holidays).status !== 'closed') {
    venue = {
      ...venue,
      closed: { ...venue.closed, dates: [...(venue.closed?.dates ?? []), input.date] },
    };
  }
  return { hours, basis: built.basis, venue };
}

/**
 * 판정 날짜에 judge가 실제로 받는 시설 정보(판정용 시설이 없으면 null).
 * 화면이 판정 사유와 같은 근거로 입장 마감 등을 보이도록 내보낸다. judgeResolved와 같은 규칙이다.
 */
export function venueForDate(
  input: Pick<JudgeInput, 'exhibition' | 'date' | 'holidays'>,
  resolved: ResolveResult,
): ResolvedVenue | null {
  const dated = datedVenue(input, resolved);
  return dated ? dated.venue : resolved.venue;
}
