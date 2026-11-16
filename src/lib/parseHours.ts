import type { DaySchedule, ParsedOperatingHours, TimeInterval, Weekday } from '../types';

/**
 * 서울시 문화행사 API의 PRO_TIME 문구를 요일별 운영시간으로 푼다.
 *
 * 문구는 등록한 사람이 자유롭게 쓴 것이라 형식이 일정하지 않다.
 *   예를 들어
 *   "10:00~18:00",
 *   "화-토 10:00~18:00 (일, 월, 공휴일 휴관)",
 *   "평일 11:00~19:00 / 토,일 12:00~18:00",
 *   "10:00~18:00 (평일, 주말 동일) 매주 금요일 21:00까지",
 *   "오전 10시 ~ 오후 6시",
 *   "1회차 14:00~15:20 / 2회차 16:00~17:20" 등이 있다.
 *
 * 읽어낼 수 없는 문구는 추측하지 않고 scheduleType: 'unknown' 으로 둔다.
 * 틀린 시간으로 "가능"이 나오는 것보다 "확인 필요"가 나오는 쪽이 안전하다.
 *
 * 종로·중구 전시 2,300건으로 재면 이렇다.
 *   제대로 읽음   1,948건 (84.7%)
 *   읽었지만 틀림     43건 ( 1.9%)   격주("1,3째주 토")와 "N일부터 변경"이 대부분이다
 *   못 읽음          309건 (13.4%)   "홈페이지 참고", "14:00"처럼 원문에 정보가 없는 것이 많다
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

/** 오전/오후를 24시간제로 바꾼다. 오후 6시 -> 18:00, 오전 12시 -> 00:00 */
function to24Hour(meridiem: string, hour: number, minute: number): string {
  let h = hour;
  if (meridiem === '오후' || meridiem === '저녁' || meridiem === '밤') {
    if (h < 12) h += 12;
  } else if (h === 12) {
    // 오전 12시는 자정
    h = 0;
  }
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// 전각 기호와 한글 시간 표기를 맞춰 둔다
function normalize(raw: string): string {
  return raw
    .replace(/[～〜∼]/g, '~')
    .replace(/[–—]/g, '-')
    .replace(/[：]/g, ':')
    // 오전/오후를 먼저 처리한다. 뒤에 돌리면 "오후 6시"가 06:00 이 되어 버린다.
    // "오후 2시~3시" 처럼 앞에만 붙은 경우는 뒤 시각에도 같이 적용한다
    .replace(
      /(오전|오후|저녁|밤|아침)\s*(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분)?\s*([~-])\s*(\d{1,2})\s*시(?!간)\s*(?:(\d{1,2})\s*분)?/g,
      (_, mer: string, h1: string, m1: string | undefined, sep: string, h2: string, m2: string | undefined) =>
        `${to24Hour(mer, Number(h1), Number(m1 ?? 0))}${sep}${to24Hour(mer, Number(h2), Number(m2 ?? 0))}`,
    )
    .replace(
      /(오전|오후|저녁|밤|아침)\s*(\d{1,2})\s*:\s*(\d{2})/g,
      (_, mer: string, h: string, min: string) => to24Hour(mer, Number(h), Number(min)),
    )
    .replace(
      /(오전|오후|저녁|밤|아침)\s*(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분)?/g,
      (_, mer: string, h: string, min: string | undefined) => to24Hour(mer, Number(h), Number(min ?? 0)),
    )
    .replace(/(\d{1,2})\s*시\s*(\d{1,2})\s*분/g, '$1:$2')
    .replace(/(\d{1,2})\s*시(?![간])/g, '$1:00')
    // 시각이 안 붙은 "오전", "오후"만 남으면 지운다 ("오전에만 운영" 같은 경우)
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

/**
 * 시간 구간 뒤에 붙은 요일 지정을 읽는다. 없으면 null
 *
 * "10:00~18:00, 화-토요일 운영" 처럼 요일이 시각 뒤에 오는 문구가 있다.
 * 다만 "10:00~18:00, 일,월 휴관" 의 요일은 운영 요일이 아니라 휴관 요일이므로,
 * "운영·개관" 같은 말이 붙은 조각만 지정으로 본다. 휴관은 (4)단계가 처리한다.
 */
function readTrailingDayScope(after: string): Weekday[] | null {
  if (/휴관|휴무/.test(after)) return null;

  const marked = /([^,/;]*?)\s*(?:운영|개관|관람\s*시간|진행|오픈)/.exec(after);
  if (marked) return readDayScope(marked[1]);

  // "10:00~12:00 (매주 토요일)" 처럼 '매주'만 붙은 경우.
  // 뒤에 다른 시각이나 '까지'가 있으면 연장·휴관 설명일 수 있어 건드리지 않는다
  if (/\d{1,2}:\d{2}|까지/.test(after)) return null;
  const weekly = /매주\s*((?:[월화수목금토일]\s*(?:요일)?\s*[,·]?\s*)+)/.exec(after);
  return weekly ? readDayScope(weekly[1]) : null;
}

/**
 * 시각이 없고 요일만 적힌 조각을 읽는다. 다음 조각의 요일 지정으로 쓴다.
 *   "기간 내 매주 토요일 / 13:00~14:30"
 */
function readDayOnlyPiece(piece: string): Weekday[] | null {
  if (/\d{1,2}:\d{2}/.test(piece)) return null;
  if (/휴관|휴무/.test(piece)) return null;
  if (!/[월화수목금토일]/.test(piece)) return null;
  return readDayScope(piece);
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

/**
 * 입장 마감 시각을 읽는다. 표현이 여러 가지다.
 *   "입장마감 17:30"            시각이 직접 적힌 경우
 *   "매표마감 18:00"            입장 대신 매표·발권으로 적는 곳도 있다
 *   "17:00 창덕궁 입장 마감"     시각이 먼저 오는 경우
 *   "종료 30분 전 입장마감"      폐관에서 빼서 계산한다
 *   "30분전 입장마감"            "종료" 없이 분만 적는 경우
 *   "관람 종료 1시간 전 입장 마감" 분이 아니라 시간으로 적는 경우
 */
function readLastAdmission(text: string, close: string): string | undefined {
  const closeMinutes = toMinutes(close);

  // 폐관에서 빼는 형태 (분)
  const minutesBefore =
    /(?:관람\s*)?(?:종료|폐관|마감)\s*(\d{1,3})\s*분\s*전/.exec(text)
    ?? /(\d{1,3})\s*분\s*전\s*(?:에\s*)?(?:입장|관람|매표|발권)?\s*(?:마감|종료)/.exec(text);
  if (minutesBefore && closeMinutes !== null) {
    return fromMinutes(closeMinutes - Number(minutesBefore[1]));
  }

  // 폐관에서 빼는 형태 (시간)
  const hoursBefore =
    /(?:관람\s*)?(?:종료|폐관|마감)\s*(\d{1,2})\s*시간\s*전/.exec(text)
    ?? /(\d{1,2})\s*시간\s*전\s*(?:에\s*)?(?:입장|관람|매표|발권)?\s*(?:마감|종료)/.exec(text);
  if (hoursBefore && closeMinutes !== null) {
    return fromMinutes(closeMinutes - Number(hoursBefore[1]) * 60);
  }

  // 시각이 직접 적힌 형태. "(입장마감) 19:00" 처럼 괄호가 끼는 경우도 받는다
  const explicit =
    /(?:입장|매표|발권|티켓|관람)\s*(?:마감|종료)\s*\)?\s*:?\s*(\d{1,2}:\d{2})/.exec(text)
    ?? /(\d{1,2}:\d{2})[^()\d]{0,10}(?:입장|매표|발권)\s*마감/.exec(text);
  if (explicit) return padTime(explicit[1]) ?? undefined;

  return undefined;
}

/**
 * "12~13시 휴관" 처럼 하루 중간에 쉬는 구간을 읽는다. 없으면 null
 * normalize 를 지나면 "12~13:00 휴관" 꼴이 된다.
 */
function readMidDayBreak(text: string): { start: number; end: number } | null {
  const m = /(\d{1,2})(?::(\d{2}))?\s*[~-]\s*(\d{1,2})(?::(\d{2}))?\s*(?:시\s*)?(?:휴관|휴게|점심)/.exec(text);
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2] ?? 0);
  const end = Number(m[3]) * 60 + Number(m[4] ?? 0);
  if (start >= end) return null;
  return { start, end };
}

// "11.17(화)", "9.2(수)", "2026.9.2(수)" -> 'YYYY-MM-DD'
function readExceptionDates(
  text: string,
  year: number,
): Array<{ date: string; raw: string; weekday: Weekday }> {
  const out: Array<{ date: string; raw: string; weekday: Weekday }> = [];
  // "11.17(화)" 와 "10월 11일(토)" 두 형식을 받는다
  const pattern = /(?:(\d{4})\s*[.년]\s*)?(\d{1,2})\s*[.월]\s*(\d{1,2})\s*[.일]?\s*\(([월화수목금토일])\)/g;
  for (const m of text.matchAll(pattern)) {
    const y = m[1] ? Number(m[1]) : year;
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    out.push({
      date: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      raw: m[0],
      weekday: KO_TO_DAY[m[4]],
    });
  }
  return out;
}

/**
 * 날짜 뒤에 "21:00까지" 처럼 끝 시각만 적힌 경우를 읽는다.
 *   "11.5.(목) 22:00까지", "10.30.(금) 21:00까지 연장운영"
 * 시작 시각이 없어 구간을 못 만들므로, 그 요일의 평소 여는 시각을 가져다 쓴다.
 */
function readUntilTime(tail: string): string | null {
  const m = /^[^0-9]{0,12}(\d{1,2}:\d{2})\s*까지/.exec(tail);
  return m ? padTime(m[1]) : null;
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
  //    먼저 떼지 않으면 (3)에서 "11.17" 의 숫자를 시각으로 착각할 수 있다.
  //    끝 시각만 적힌 경우("22:00까지")는 그 요일의 여는 시각이 필요해 뒤로 미룬다
  let rest = text;
  const pendingUntil: Array<{ date: string; weekday: Weekday; close: string }> = [];
  for (const found of readExceptionDates(text, year)) {
    const idx = rest.indexOf(found.raw);
    if (idx < 0) continue;
    // 그 날짜 뒤쪽에서 시간 구간을 찾는다
    const after = rest.slice(idx + found.raw.length);
    const tail = after.slice(0, 60);
    const rangeMatch = /(\d{1,2}:\d{2})\s*[~-]\s*(\d{1,2}:\d{2})/.exec(tail);
    const range = rangeMatch ? readRange(rangeMatch[0]) : null;
    const until = readUntilTime(tail);

    // 날짜와 함께 지울 길이. 예외로 옮긴 시각이 요일 규칙에도 남으면
    // "11.17(화) 오픈식 14:00~16:00" 의 14:00~16:00 이 다른 요일에까지 들어간다
    let consume = found.raw.length;
    if (range && rangeMatch) {
      exceptions.push({
        date: found.date,
        schedule: { isOpen: true, intervals: [range] },
      });
      consume += rangeMatch.index + rangeMatch[0].length;
    } else if (until) {
      pendingUntil.push({ date: found.date, weekday: found.weekday, close: until });
    } else if (/휴관|휴무/.test(tail)) {
      exceptions.push({ date: found.date, schedule: { isOpen: false, intervals: [] } });
    }
    rest = rest.slice(0, idx) + ' ' + rest.slice(idx + consume);
  }

  // (3) 조각으로 나눈다. '/'와 '※', '*'가 규칙 경계로 쓰인다.
  //    '·'는 "토·공휴일" 처럼 요일을 잇는 데도 쓰여서 경계로 쓰지 않는다
  const pieces = rest
    .split(/[/;]|※|\*+|\s+단,\s*/)
    .map(p => p.trim())
    .filter(Boolean);

  // 시간 구간을 하나씩 훑고, 앞 구간이 끝난 지점부터 이번 구간 앞까지를 요일 지정으로 읽는다.
  // 쉼표로 쪼개면 "토,일" 같은 요일 목록이 같이 끊겨서 이 방식으로 바꿨다.
  type Assignment = { scope: Weekday[] | null; interval: TimeInterval };
  const assignments: Assignment[] = [];

  // 앞 조각이 요일만 적고 끝났으면 다음 조각의 지정으로 쓴다
  //   "기간 내 매주 토요일 / 13:00~14:30"
  let carried: Weekday[] | null = null;
  // 가장 최근에 나온 요일 지정. 시각만 있는 조각이 뒤따르면 같은 요일의 다음 회차로 본다
  //   "수요일·목요일 10:00~12:00 / 14:00~16:00"
  let lastScope: Weekday[] | null = null;

  for (const piece of pieces) {
    const matches = [...piece.matchAll(/(\d{1,2}:\d{2})\s*[~-]\s*(\d{1,2}:\d{2})/g)];
    if (!matches.length) {
      carried = readDayOnlyPiece(piece);
      continue;
    }
    // 시각 말고는 아무 말도 없는 조각인지 본다. "(동절기) 10:00~18:00" 은 아니다
    const bare = piece.replace(/(\d{1,2}:\d{2})\s*[~-]\s*(\d{1,2}:\d{2})/g, '').trim() === '';
    const fromPrevious: Weekday[] | null = carried ?? (bare ? lastScope : null);
    carried = null;
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

      // 요일은 보통 시각 앞에 오지만, "10:00~18:00, 화-토요일 운영" 처럼 뒤에 올 때도 있다
      let scope = readDayScope(scopeText);
      if (scope === null && matches.length === 1) {
        scope = readTrailingDayScope(piece.slice(cursor)) ?? fromPrevious;
      }
      if (scope) lastScope = scope;
      assignments.push({ scope, interval });
    }
  }

  if (!assignments.length) return unknown();

  // 요일 지정이 없는 구간은 7일 전부에 넣는다. 회차가 여러 개면 구간도 여러 개가 된다
  //   "1회차 14:00~15:20 / 2회차 16:00~17:20" -> 모든 요일에 구간 2개
  //
  // 단, 요일 지정이 한 번 나온 뒤의 무지정 구간은 7일로 펼치지 않는다.
  // "화-일요일 10:00~18:00 / 오픈식 14:00~16:00" 에서 오픈식 시각이 월요일에까지
  // 들어가면 안 된다. 앞에서 월요일은 운영하지 않는다고 이미 말했기 때문이다
  const firstScoped = assignments.findIndex(a => a.scope !== null);
  const shared = assignments
    .filter((a, i) => a.scope === null && (firstScoped < 0 || i < firstScoped))
    .map(a => a.interval);

  // 요일이 지정된 구간은 그 요일에만 넣고, 지정 없는 구간을 덮어쓴다
  //   "10:00~18:00 / 토 12:00~18:00" -> 토요일만 12:00~18:00
  const perDay = new Map<Weekday, TimeInterval[]>();
  for (const { scope, interval } of assignments) {
    if (!scope) continue;
    for (const day of scope) {
      perDay.set(day, [...(perDay.get(day) ?? []), interval]);
    }
  }

  for (const day of ORDER) {
    const intervals = perDay.get(day) ?? shared;
    // 같은 구간이 두 번 적힌 경우("1회차 14:00~15:30 / 2회차 14:00~15:30")는 하나로 둔다
    const unique = intervals.filter(
      (iv, i) => intervals.findIndex(other => JSON.stringify(other) === JSON.stringify(iv)) === i,
    );
    if (unique.length) weekdays[day] = { isOpen: true, intervals: unique };
  }

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

  // (5) 연장 운영: (3)에서 넣어둔 구간의 close 만 바꿔치운다.
  //    "금요일은 21:00까지" 처럼 조사가 끼기도 하고,
  //    "화,수,금,토,일 21:00까지" 처럼 요일이 여러 개이기도 하다
  for (const m of text.matchAll(
    /(?:매주\s*)?((?:[월화수목금토일]\s*(?:요일)?\s*[,·]?\s*)+)(?:은|는|에|부터)?\s*(\d{1,2}:\d{2})\s*까지/g,
  )) {
    const close = padTime(m[2]);
    if (!close) continue;
    // "요일" 의 '일' 을 일요일로 세지 않도록 먼저 지운다
    const listed = m[1].replace(/요일/g, '');
    const days = [...new Set([...listed.matchAll(/[월화수목금토일]/g)].map(d => KO_TO_DAY[d[0]]))];
    for (const day of days) {
      const cur = weekdays[day];
      if (!cur.isOpen || !cur.intervals.length) continue;
      const last = cur.intervals[cur.intervals.length - 1];
      if ((toMinutes(close) ?? 0) <= (toMinutes(last.open) ?? 0)) continue;
      weekdays[day] = {
        ...cur,
        intervals: [...cur.intervals.slice(0, -1), { ...last, close }],
        note: '연장 운영',
      };
    }
  }

  // (6) 하루 중간에 쉬는 구간이 있으면 그 요일의 구간을 둘로 쪼갠다
  //    "10:00~18:00 (※ 12~13시 휴관)" -> 10:00~12:00, 13:00~18:00
  const midBreak = readMidDayBreak(text);
  if (midBreak) {
    for (const d of ORDER) {
      const cur = weekdays[d];
      if (!cur.isOpen) continue;
      const split: TimeInterval[] = [];
      for (const iv of cur.intervals) {
        const open = toMinutes(iv.open);
        const close = toMinutes(iv.close);
        // 쉬는 구간이 이 구간 안에 들어 있지 않으면 그대로 둔다
        if (open === null || close === null || midBreak.start <= open || midBreak.end >= close) {
          split.push(iv);
          continue;
        }
        split.push({ ...iv, close: fromMinutes(midBreak.start), lastAdmission: undefined });
        split.push({ ...iv, open: fromMinutes(midBreak.end) });
      }
      weekdays[d] = {
        ...cur,
        intervals: split.map(iv => (iv.lastAdmission ? iv : { open: iv.open, close: iv.close })),
      };
    }
  }

  // (7) 끝 시각만 적혀 있던 날짜 예외를 그 요일의 여는 시각으로 채운다
  //    "11.5.(목) 22:00까지" -> 목요일이 11:00 에 열면 11:00~22:00
  for (const { date, weekday, close } of pendingUntil) {
    const base = weekdays[weekday];
    const open = base.isOpen && base.intervals.length ? base.intervals[0].open : null;
    if (!open) continue;
    const a = toMinutes(open);
    const b = toMinutes(close);
    if (a === null || b === null || a >= b) continue;
    exceptions.push({ date, schedule: { isOpen: true, intervals: [{ open, close }] } });
  }

  if (/사전\s*예약|예약\s*필[수요]/.test(text)) {
    for (const d of ORDER) {
      if (weekdays[d].isOpen) weekdays[d] = { ...weekdays[d], requiresReservation: true };
    }
  }

  return { scheduleType: 'scheduled', weekdays, holiday, exceptions };
}
