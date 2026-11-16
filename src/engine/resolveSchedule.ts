import type { JudgeInput, JudgeResult, ParsedOperatingHours, TimeInterval, Venue, Weekday } from '../types';
import { judge, type ResolvedVenue } from './judge';
import { toMinutes, fromMinutes } from './time';
import { REASONS } from './reasons';

const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export type ResolveBasis = 'venue' | 'exhibition' | 'merged';

/** 시설 데이터와 전시 운영 시간이 다른 곳. 시설 데이터 점검용이다. */
export interface Mismatch {
  weekday: Weekday;
  kind: 'closed' | 'open' | 'close' | 'lastEntry';
  /** 시설 쪽 값. closed면 'closed', 시설에 값이 없으면 null */
  venueValue: string | null;
  /** 전시 쪽 값. closed면 전시 구간('10:00~18:00') */
  exhibitionValue: string | null;
}

export interface ResolveResult {
  venue: ResolvedVenue | null;
  basis: ResolveBasis | null;
  mismatches: Mismatch[];
}

export interface ResolveOptions {
  /** true면 전시 운영 시간도 판정에 쓴다. 기본은 false(시설만). */
  useExhibitionHours: boolean;
}

/** 믿을 수 있는 전시 구간. 시각은 분으로 읽어 둔다. */
interface TrustedDay {
  interval: TimeInterval;
  open: number;
  close: number;
}

/**
 * 전시 운영 시간 중 "믿을 수 있는 요일"만 고른다.
 * - scheduleType이 'scheduled'일 때만 본다
 * - 그 요일이 isOpen: true, 구간이 정확히 하나, open < close (둘 다 HH:MM)
 * 나머지 요일은 "모름"이다. isOpen: false도 해석기가 "모름"과 "휴관"을 구분하지 못해 "모름"으로 본다.
 */
function trustedDays(hours: ParsedOperatingHours | undefined): Partial<Record<Weekday, TrustedDay>> {
  const out: Partial<Record<Weekday, TrustedDay>> = {};
  if (!hours || hours.scheduleType !== 'scheduled') return out;
  for (const wd of WEEKDAYS) {
    const day = hours.weekdays?.[wd];
    if (!day || day.isOpen !== true || day.intervals.length !== 1) continue;
    const interval = day.intervals[0];
    const open = toMinutes(interval.open);
    const close = toMinutes(interval.close);
    if (open === null || close === null || open >= close) continue;
    out[wd] = { interval: { ...interval }, open, close };
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

/** 시설과 전시(믿을 수 있는 요일만)의 차이를 모은다. */
function findMismatches(venue: Venue, trusted: Partial<Record<Weekday, TrustedDay>>): Mismatch[] {
  const out: Mismatch[] = [];
  for (const wd of WEEKDAYS) {
    const t = trusted[wd];
    if (!t) continue;
    const { interval } = t;

    // 시설은 휴관인데 전시는 연다고 적힌 요일
    if (venue.closed?.weekday === wd) {
      out.push({
        weekday: wd,
        kind: 'closed',
        venueValue: 'closed',
        exhibitionValue: `${interval.open}~${interval.close}`,
      });
      continue;
    }

    // 시설에 그 요일 시간이 없으면 비교할 수 없다
    const vh = venue.hours?.[wd];
    if (vh) {
      if (vh.open !== interval.open) {
        out.push({ weekday: wd, kind: 'open', venueValue: vh.open, exhibitionValue: interval.open });
      }
      if (vh.close !== interval.close) {
        out.push({ weekday: wd, kind: 'close', venueValue: vh.close, exhibitionValue: interval.close });
      }
    }

    // 입장 마감은 전시에 적혀 있을 때만 비교한다
    if (interval.lastAdmission !== undefined && venue.lastEntry !== interval.lastAdmission) {
      out.push({
        weekday: wd,
        kind: 'lastEntry',
        venueValue: venue.lastEntry ?? null,
        exhibitionValue: interval.lastAdmission,
      });
    }
  }
  return out;
}

/** 시설이 없을 때 전시 운영 시간만으로 만드는 판정용 시설. */
function venueFromExhibition(trusted: Partial<Record<Weekday, TrustedDay>>): ResolvedVenue {
  const hours: NonNullable<Venue['hours']> = {};
  const lastEntryByDay: Partial<Record<Weekday, string>> = {};
  for (const wd of WEEKDAYS) {
    const t = trusted[wd];
    if (!t) continue;
    hours[wd] = { open: t.interval.open, close: t.interval.close };
    const la = t.interval.lastAdmission;
    const laMin = la === undefined ? null : toMinutes(la);
    if (la !== undefined && laMin !== null && laMin <= t.close) {
      lastEntryByDay[wd] = la;
    }
  }
  // judge는 hours, closed, lastEntry, visitMinutes, lastEntryByDay, basis만 읽는다.
  // 나머지는 타입을 채우기 위한 빈 값이다. 이 객체를 지도·목록에 쓰지 않는다.
  return {
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
}

/** 시설과 전시가 둘 다 있을 때 요일별로 겹치는 시간을 만든다. 휴관 규칙은 시설 것. */
function mergeVenue(venue: Venue, trusted: Partial<Record<Weekday, TrustedDay>>): ResolvedVenue {
  const base = copyVenue(venue);
  const hours: NonNullable<Venue['hours']> = {};
  const lastEntryByDay: Partial<Record<Weekday, string>> = {};

  for (const wd of WEEKDAYS) {
    const vh = base.hours?.[wd];
    if (!vh) continue; // 시설에 없는 요일은 전시가 있어도 넣지 않는다
    const t = trusted[wd];
    const vOpen = toMinutes(vh.open);
    const vClose = toMinutes(vh.close);

    // 전시가 "모름"이거나 시설 시각을 읽을 수 없으면 시설 시간 그대로 (judge가 판단)
    if (!t || vOpen === null || vClose === null) {
      hours[wd] = vh;
      continue;
    }

    const open = Math.max(vOpen, t.open);
    const close = Math.min(vClose, t.close);
    if (open >= close) continue; // 겹치는 시간이 없으면 그 요일은 뺀다

    hours[wd] = { open: fromMinutes(open), close: fromMinutes(close) };
    const le = minTime(venue.lastEntry, t.interval.lastAdmission);
    if (le !== null) lastEntryByDay[wd] = fromMinutes(Math.min(le, close));
  }

  return { ...base, hours, lastEntryByDay, basis: 'merged' };
}

/**
 * 시설 정보와 전시 운영 시간으로 판정에 쓸 시설 정보를 만든다.
 * 입력 venue, hours는 바꾸지 않는다.
 */
export function resolveSchedule(
  venue: Venue | null,
  hours: ParsedOperatingHours | undefined,
  options: ResolveOptions = { useExhibitionHours: false },
): ResolveResult {
  const trusted = trustedDays(hours);
  const hasTrusted = Object.keys(trusted).length > 0;
  const mismatches = venue ? findMismatches(venue, trusted) : [];

  if (venue) {
    if (!options.useExhibitionHours || !hasTrusted) {
      return { venue: { ...copyVenue(venue), basis: 'venue' }, basis: 'venue', mismatches };
    }
    return { venue: mergeVenue(venue, trusted), basis: 'merged', mismatches };
  }

  if (options.useExhibitionHours && hasTrusted) {
    return { venue: venueFromExhibition(trusted), basis: 'exhibition', mismatches };
  }

  return { venue: null, basis: null, mismatches };
}

/** resolveSchedule 결과로 판정한다. 시설 정보가 없으면 확인 필요(MISSING_VENUE). */
export function judgeResolved(input: Omit<JudgeInput, 'venue'>, resolved: ResolveResult): JudgeResult {
  if (resolved.venue === null) {
    return { result: 'unknown', reasons: [REASONS.MISSING_VENUE] };
  }
  return judge({ ...input, venue: resolved.venue });
}
