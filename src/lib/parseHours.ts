import type { DaySchedule, ParsedOperatingHours, TimeInterval, Weekday } from '../types';

/**
 * 서울시 문화행사 API의 PRO_TIME 문구를 요일별 운영시간으로 푼다.
 *
 * 문구는 등록한 사람이 자유롭게 쓴 것이라 형식이 일정하지 않다.
 *   예를 들어
 *   "10:00~18:00",
 *   "화-토 10:00~18:00 (일, 월, 공휴일 휴관)",
 *   "평일 11:00~19:00 / 토,일 12:00~18:00",
 *   "10:00~18:00 (평일, 주말 동일) 매주 금요일 21:00까지" 등이 있다.
 *
 * 읽어낼 수 없는 문구는 추측하지 않고 scheduleType: 'unknown' 으로 둔다.
 */

const ORDER: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const KO_TO_DAY: Record<string, Weekday> = {
  '월': 'mon', '화': 'tue', '수': 'wed', '목': 'thu', '금': 'fri', '토': 'sat', '일': 'sun',
};

const WEEKDAYS_ONLY: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
const WEEKEND_ONLY: Weekday[] = ['sat', 'sun'];

function emptyDay(): DaySchedule {
  return { isOpen: false, intervals: [] };
}

function unknown(): ParsedOperatingHours {
  return {
    scheduleType: 'unknown',
    weekdays: Object.fromEntries(ORDER.map(d => [d, emptyDay()])) as Record<Weekday, DaySchedule>,
    holiday: null,
    exceptions: [],
  };
}

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

function fromMinutes(n: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, n));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

// '9:00' -> '09:00'. 24:00 은 판정 쪽 toMinutes 가 거부하므로 23:59 로 둔다
function padTime(raw: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  if (h === 24) return min === 0 ? '23:59' : null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// 전각 기호와 한글 시간 표기를 맞춰 둔다
function normalize(raw: string): string {
  return raw
    .replace(/[～〜∼]/g, '~')
    .replace(/[–—]/g, '-')
    .replace(/[：]/g, ':')
    .replace(/(\d{1,2})\s*시\s*(\d{1,2})\s*분/g, '$1:$2')
    .replace(/(\d{1,2})\s*시(?![간])/g, '$1:00')
    .replace(/오전\s*/g, '')
    .replace(/오후\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// "화-토", "화-일요일", "월-금" 처럼 범위로 적힌 요일을 펼친다
function expandRange(from: Weekday, to: Weekday): Weekday[] {
  const a = ORDER.indexOf(from);
  const b = ORDER.indexOf(to);
  if (a <= b) return ORDER.slice(a, b + 1);
  return [...ORDER.slice(a), ...ORDER.slice(0, b + 1)];
}

// 조각 앞부분에서 요일 지정을 읽는다. 없으면 null
function readDayScope(piece: string): Weekday[] | null {
  if (/평일/.test(piece)) return [...WEEKDAYS_ONLY];
  if (/주말/.test(piece)) return [...WEEKEND_ONLY];
  if (/매일|월\s*-\s*일/.test(piece)) return [...ORDER];

  // "화-토", "화 - 토요일", "화-일요일"
  const range = /([월화수목금토일])\s*(?:요일)?\s*[-~]\s*([월화수목금토일])\s*(?:요일)?/.exec(piece);
  if (range) return expandRange(KO_TO_DAY[range[1]], KO_TO_DAY[range[2]]);

  // "토,일", "화,수,금,토,일", "수,금"
  const listed = [...piece.matchAll(/([월화수목금토일])\s*(?:요일)?\s*(?=[,·]|\s|$)/g)]
    .map(m => KO_TO_DAY[m[1]]);
  // 숫자 바로 앞에 붙은 단일 요일도 지정으로 본다 ("토 12:00~18:00")
  if (listed.length) return [...new Set(listed)];

  return null;
}

// 조각에서 첫 번째 시간 구간을 읽는다
function readRange(piece: string): { open: string; close: string } | null {
  const m = /(\d{1,2}:\d{2})\s*[~-]\s*(\d{1,2}:\d{2})/.exec(piece);
  if (!m) return null;
  const open = padTime(m[1]);
  const close = padTime(m[2]);
  if (!open || !close) return null;
  const a = toMinutes(open);
  const b = toMinutes(close);
  if (a === null || b === null || a >= b) return null;
  return { open, close };
}

// "입장마감 17:30", "17:00 입장 마감", "종료 30분 전 입장마감"
function readLastAdmission(text: string, close: string): string | undefined {
  const before = /(?:관람\s*)?(?:종료|마감)\s*(\d{1,3})\s*분\s*전/.exec(text);
  if (before) {
    const c = toMinutes(close);
    if (c !== null) return fromMinutes(c - Number(before[1]));
  }
  const explicit = /입장\s*마감\s*:?\s*(\d{1,2}:\d{2})/.exec(text)
    ?? /(\d{1,2}:\d{2})[^()\d]{0,10}입장\s*마감/.exec(text);
  if (explicit) return padTime(explicit[1]) ?? undefined;
  return undefined;
}

// "11.17(화)", "9.2(수)", "2026.9.2(수)" -> 'YYYY-MM-DD'
function readExceptionDates(text: string, year: number): Array<{ date: string; raw: string }> {
  const out: Array<{ date: string; raw: string }> = [];
  for (const m of text.matchAll(/(?:(\d{4})\s*\.\s*)?(\d{1,2})\s*\.\s*(\d{1,2})\s*\.?\s*\(([월화수목금토일])\)/g)) {
    const y = m[1] ? Number(m[1]) : year;
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    out.push({
      date: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      raw: m[0],
    });
  }
  return out;
}

/**
 * 운영시간 문구를 파싱한다.
 *
 * 한 문구가 단계를 거치며 어떻게 바뀌는지 따라가 보면 이렇다.
 *
 *   원문      "화-일 10:00~18:00 ※ 월 휴관, 금 21:00 까지 야간개관"
 *
 *   normalize  전각 기호와 "10시" 표기를 맞추고 공백을 하나로 줄인다. 여기서는 그대로.
 *
 *   (1) 걸러내기  시각이 있으니 통과. ("프로그램별 상이" 같으면 여기서 unknown 으로 끝난다)
 *
 *   (2) 날짜 예외  "11.17(화)" 같은 날짜가 없어 rest 는 원문 그대로.
 *               있으면 그 부분을 exceptions 로 옮기고 rest 에서 지운다.
 *
 *   (3) 요일 배정  '※' 로 조각을 나눈다
 *                 ["화-일 10:00~18:00", "월 휴관, 금 21:00 까지 야간개관"]
 *               첫 조각에서 구간 10:00~18:00 을 찾고, 그 앞 "화-일 " 을 요일로 읽는다
 *                 화·수·목·금·토·일 → 10:00-18:00   (월은 지정에 없어 닫힌 채(운영하지 않는 날로 가정)로 남는다)
 *               둘째 조각에는 "21:00" 하나뿐이라 구간이 아니므로 아무것도 안 넣는다
 *
 *   (4) 휴관      "휴관" 앞쪽("화-일 10:00~18:00 월")에서 마지막 시각((10:00~18:00)) 뒤만 본다 -> " ※ 월 " → 월을 닫는다
 *               (앞쪽 "화-일" 까지 보면 화·일도 닫혀 버린다)
 *
 *   (5) 연장      "금 21:00 까지" -> 금요일만 close 를 21:00 으로 바꾸고 note 를 붙인다
 *
 *   결과
 *       {
 *         "scheduleType": "scheduled",
 *         "weekdays": {
 *           "mon": {"isOpen":false,"intervals":[]},
 *           "tue": {"isOpen":true,"intervals":[{"open":"10:00","close":"18:00"}]},
 *           "wed": {"isOpen":true,"intervals":[{"open":"10:00","close":"18:00"}]},
 *           "thu": {"isOpen":true,"intervals":[{"open":"10:00","close":"18:00"}]},
 *           "fri": {"isOpen":true,"intervals":[{"open":"10:00","close":"21:00"}],"note":"연장 운영"},
 *           "sat": {"isOpen":true,"intervals":[{"open":"10:00","close":"18:00"}]},
 *           "sun": {"isOpen":true,"intervals":[{"open":"10:00","close":"18:00"}]}
 *         },
 *         "holiday": null,      // 공휴일 언급이 없었다는 뜻
 *         "exceptions": []      // 특정 날짜 예외가 없었다는 뜻
 *       }
 *
 * @param raw PRO_TIME 원문
 * @param year 특정 날짜 예외에 붙일 연도 (보통 전시 시작 연도)
 */
export function parseHours(raw: string, year: number): ParsedOperatingHours {
  const text = normalize(raw || '');
  if (!text) return unknown();

  // (1) 시각이 하나도 없으면 읽을 게 없다
  if (!/\d{1,2}:\d{2}/.test(text)) {
    if (/상시|상설|연중무휴|제한\s*없음/.test(text)) {
      const day: DaySchedule = { isOpen: true, intervals: [{ open: '00:00', close: '23:59' }] };
      return {
        scheduleType: 'always_open',
        weekdays: Object.fromEntries(ORDER.map(d => [d, { ...day }])) as Record<Weekday, DaySchedule>,
        holiday: null,
        exceptions: [],
      };
    }
    return unknown();
  }

  // 0:00~24:00 처럼 하루 전체를 적은 경우
  if (/0?0:00\s*[~-]\s*24:00/.test(text)) {
    const day: DaySchedule = { isOpen: true, intervals: [{ open: '00:00', close: '23:59' }] };
    return {
      scheduleType: 'always_open',
      weekdays: Object.fromEntries(ORDER.map(d => [d, { ...day }])) as Record<Weekday, DaySchedule>,
      holiday: null,
      exceptions: [],
    };
  }

  const weekdays = Object.fromEntries(ORDER.map(d => [d, emptyDay()])) as Record<Weekday, DaySchedule>;
  const exceptions: ParsedOperatingHours['exceptions'] = [];

  // (2) 특정 날짜 예외를 먼저 떼어낸다. 남은 문구가 요일 규칙이 된다.
  //    먼저 떼지 않으면 (3)에서 "11.17" 의 숫자를 시각으로 착각할 수 있다
  let rest = text;
  for (const found of readExceptionDates(text, year)) {
    const idx = rest.indexOf(found.raw);
    if (idx < 0) continue;
    // 그 날짜 뒤쪽에서 시간 구간을 찾는다
    const tail = rest.slice(idx, idx + 60);
    const range = readRange(tail);
    if (range) {
      exceptions.push({
        date: found.date,
        schedule: { isOpen: true, intervals: [range] },
      });
    } else if (/휴관|휴무/.test(tail)) {
      exceptions.push({ date: found.date, schedule: { isOpen: false, intervals: [] } });
    }
    rest = rest.slice(0, idx) + ' ' + rest.slice(idx + found.raw.length);
  }

  // (3) 조각으로 나눈다. '/'와 '※', '*'가 규칙 경계로 쓰인다
  const pieces = rest
    .split(/[/·]|※|\*+|\s+단,\s*/)
    .map(p => p.trim())
    .filter(Boolean);

  // 시간 구간을 하나씩 훑고, 앞 구간이 끝난 지점부터 이번 구간 앞까지를 요일 지정으로 읽는다.
  // 쉼표로 쪼개면 "토,일" 같은 요일 목록이 같이 끊겨서 이 방식으로 바꿨다.
  // 요일 지정이 아예 없으면 7일 전부로 본다
  let assignedAny = false;
  for (const piece of pieces) {
    const matches = [...piece.matchAll(/(\d{1,2}:\d{2})\s*[~-]\s*(\d{1,2}:\d{2})/g)];
    let cursor = 0;
    for (const m of matches) {
      const scopeText = piece.slice(cursor, m.index);
      cursor = m.index + m[0].length;

      const open = padTime(m[1]);
      const close = padTime(m[2]);
      if (!open || !close) continue;
      const a = toMinutes(open);
      const b = toMinutes(close);
      if (a === null || b === null || a >= b) continue;

      const interval: TimeInterval = { open, close };
      const la = readLastAdmission(text, close);
      if (la) interval.lastAdmission = la;

      for (const d of readDayScope(scopeText) ?? ORDER) {
        weekdays[d] = { isOpen: true, intervals: [interval] };
      }
      assignedAny = true;
    }
  }

  if (!assignedAny) return unknown();

  // (4) 휴관 선언을 반영해 (3)에서 열어둔 요일을 다시 닫는다
  let holiday: DaySchedule | null = null;
  for (const m of text.matchAll(/(.*?)(?:휴관|휴무)/gs)) {
    // 시간 구간 앞쪽은 운영시간 설명이므로 제외하고, 마지막 시각 뒤부터만 본다
    const near = m[1].replace(/[\s\S]*\d{1,2}:\d{2}/, '').slice(-20);
    for (const d of [...near.matchAll(/([월화수목금토일])\s*(?:요일)?/g)]) {
      weekdays[KO_TO_DAY[d[1]]] = emptyDay();
    }
    // 음력 명절은 holidays.json 에 들어 있으니 공휴일 휴관으로 본다
    if (/공휴일|국경일|설|추석|명절/.test(near)) holiday = { isOpen: false, intervals: [] };
  }

  // (5) 연장 운영: (3)에서 넣어둔 구간의 close 만 바꿔치운다
  for (const m of text.matchAll(/(?:매주\s*)?([월화수목금토일])\s*(?:요일)?\s*(\d{1,2}:\d{2})\s*까지/g)) {
    const day = KO_TO_DAY[m[1]];
    const close = padTime(m[2]);
    const cur = weekdays[day];
    if (!close || !cur.isOpen || !cur.intervals.length) continue;
    weekdays[day] = {
      ...cur,
      intervals: [{ ...cur.intervals[0], close }],
      note: '연장 운영',
    };
  }

  if (/사전\s*예약|예약\s*필[수요]/.test(text)) {
    for (const d of ORDER) {
      if (weekdays[d].isOpen) weekdays[d] = { ...weekdays[d], requiresReservation: true };
    }
  }

  return { scheduleType: 'scheduled', weekdays, holiday, exceptions };
}
