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
 * 요일별 일정으로 담을 수 없는 두 가지는 타입을 늘려 담는다.
 *   "1, 3째주 토 ..."        -> DaySchedule.weeksOfMonth
 *   "9.15.(화)부터 ..."       -> ParsedOperatingHours.periods
 * 판정하는 쪽에서 이 둘을 보지 않으면 쉬는 주나 아직 오지 않은 날의 일정을
 * 적용해 "가능"이 잘못 나온다.
 *
 * 종로·중구 전시 2,300건으로 재면 이렇다.
 *   제대로 읽음   1,948건 (84.7%)
 *   읽었지만 틀림     43건 ( 1.9%)
 *   못 읽음          309건 (13.4%)   "홈페이지 참고", "14:00"처럼 원문에 정보가 없는 것이 많다
 */

const ORDER: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const KO_TO_DAY: Record<string, Weekday> = {
  '월': 'mon', '화': 'tue', '수': 'wed', '목': 'thu', '금': 'fri', '토': 'sat', '일': 'sun',
};

const WEEKDAYS_ONLY: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
const WEEKEND_ONLY: Weekday[] = ['sat', 'sun'];

// DaySchedule.note 에 넣는 메시지
const SESSION_NOTE = '회차 운영';
const EXTENSION_NOTE = '연장 운영';
// 구간 앞에 붙는 계절 표시. "하절기", "동절기(11~2월)", "여름철"
//   "겨울방학 프로그램" 같은 행사 이름까지 잡지 않도록 '철'·'기'가 붙은 말만 본다
const SEASON_LABEL = /하절기|동절기|하계|동계|여름철|겨울철/;

/**
 * 한 요일에 계절별 시간이 겹쳐 들어 있으면 겹치는 시간 하나로 줄인다.
 *   하절기 10:00~19:00, 동절기 10:00~18:00 -> 10:00~18:00
 *   (평일) 10:00~18:00, 동절기 10:00~17:00  -> 10:00~17:00   (계절 표시가 한쪽에만 있는 경우)
 *
 * 문구에 몇 월이 어느 계절인지 없는 경우가 많고, 있어도 기관마다 다르다.
 * 판정 날짜가 어느 계절인지 모르면서 긴 쪽을 쓰면 동절기 18~19시에 틀린 "가능"이 나온다.
 * 겹치는 시간만 쓰면 하절기 18~19시를 "불가"로 잘못 말할 수는 있어도 틀린 "가능"은 나오지 않는다.
 *
 * 계절 구간과 시간이 겹치는 구간만 합친다. 겹치지 않는 구간(다른 회차 등)은 그대로 둔다.
 *
 * 합친 구간은 새 객체라 sessionIntervals 로 찾을 수 없다. 합친 구간이 전부 회차였으면
 * 새 구간도 sessionIntervals 에 넣어 그 요일의 sessions 가 빠지지 않게 한다.
 */
function mergeSeasons(
  intervals: TimeInterval[],
  seasonIntervals: Set<TimeInterval>,
  sessionIntervals: Set<TimeInterval>,
): TimeInterval[] {
  const seasonal = intervals.filter(iv => seasonIntervals.has(iv));
  if (!seasonal.length || intervals.length < 2) return intervals;

  const range = (iv: TimeInterval) => [toMinutes(iv.open) ?? 0, toMinutes(iv.close) ?? 0];
  const overlaps = (x: TimeInterval, y: TimeInterval) => {
    const [a1, b1] = range(x);
    const [a2, b2] = range(y);
    return a1 < b2 && a2 < b1;
  };
  const group = intervals.filter(iv => seasonIntervals.has(iv) || seasonal.some(s => overlaps(s, iv)));
  if (group.length < 2) return intervals;

  const open = Math.max(...group.map(iv => range(iv)[0]));
  const close = Math.min(...group.map(iv => range(iv)[1]));
  const merged: TimeInterval = { open: fromMinutes(open), close: fromMinutes(close) };
  const admissions = group
    .map(iv => (iv.lastAdmission ? toMinutes(iv.lastAdmission) : null))
    .filter((m): m is number => m !== null);
  if (admissions.length) merged.lastAdmission = fromMinutes(Math.min(close, ...admissions));
  // 상시 관람 구간이 하나라도 섞였으면 회차로 보지 않는다
  if (group.every(iv => sessionIntervals.has(iv))) sessionIntervals.add(merged);

  // 원래 자리(그룹의 첫 구간 위치)에 넣어 구간 순서를 지킨다.
  // 계절끼리 겹치지 않으면(open >= close) 어느 시간도 확실하지 않으므로 그룹을 모두 뺀다
  const out: TimeInterval[] = [];
  for (const iv of intervals) {
    if (!group.includes(iv)) out.push(iv);
    else if (iv === group[0] && open < close) out.push(merged);
  }
  return out;
}

// 구간 바로 뒤에 붙는 반복 회차 표시. "18:00 ~ 22:00, 매 정각마다", "10:00~17:00 매시 정각 입장"
//   구간 안에서 정해진 시각에만 들어갈 수 있으므로 회차로 본다.
//   "매 정각 도슨트" 처럼 해설 프로그램을 덧붙인 경우는 관람 자체가 회차인 것이 아니므로 뺀다
const EVERY_SESSION =
  /^[^/※]{0,6}(?:매\s*(?:시\s*)?정각|정시\s*마다|매시\s*(?:정각|00분)|매\s*\d{1,3}\s*분\s*(?:마다|간격))(?![^/※]{0,10}(?:도슨트|해설|투어|설명))/;

// 구간 바로 앞에 붙는 회차 표시. "1회차", "2차시", "A타임", "1부:", "오전반("
//   - 회차·차시·타임은 앞에 번호가 있을 때만 본다. "타임스퀘어", "회차별 상이" 는 회차가 아니다
//   - normalize() 가 "오전"/"오후"를 지우므로 "오전반(" 은 여기 올 때 "반(" 만 남는다.
//     '반'·'부' 앞에 한글이 오면("주말부") 회차가 아니다
const SESSION_LABEL = /[0-9A-Za-z]\s*(?:회차|차시|타임)|(?:^|[^가-힣])[반부]\s*[(:：]?\s*$/;

// 휴관 목록에 들어가는 낱말만으로 이루어진 조각. "매주 월요일", "매년 1월 1일 및 설·추석 당일"
//   괄호 닫힘이나 "도슨트", "야간개관" 같은 다른 말이 섞이면 휴관 목록이 아니다
const CLOSURE_ITEM = new RegExp(
  '^(?:\\s|·|매주|매월|매달|매년|격주|[첫둘셋넷]째|다섯째|마지막|\\d+\\s*째|주|' +
    '\\d+\\s*[월일]|[월화수목금토일](?:요일)?|' +
    '법정\\s*공휴일|대체\\s*공휴일|공휴일|국경일|신정|구정|설날|설|추석|명절|당일|연휴|전날|다음\\s*날|및)+$',
);
// 휴관 목록이 시작되는 경계. "(매주 월요일, ...", "※ 매주 월요일, ...", "(토, 일 도슨트), 매주 월요일, ..."
const CLAUSE_START = /[()（）※/*\n]/;

/**
 * "휴관" 앞의 20자보다 앞으로 이어진 휴관 목록을 찾아 돌려준다. 없으면 빈 문자열.
 *   "(매주 월요일, 매년 1월 1일 및 설·추석 당일" -> "매주 월요일"
 *   (20자만 보면 "매주 월요일"이 잘려 월요일에 틀린 "가능"이 나온다)
 *
 * 쉼표 앞 조각을 뒤에서부터 보되, 목록이 시각 바로 뒤나 '(', '※' 같은 경계까지
 * 휴관 목록 낱말로만 끊김 없이 이어질 때만 인정한다. 중간에 다른 말이 있으면
 * 다른 안내("도슨트: 토, 일")의 쉼표 목록일 수 있으므로 하나도 덧붙이지 않는다.
 */
function readLongClosureList(before: string): string {
  const segments = before.split(',');
  segments.pop();
  const extra: string[] = [];
  for (let i = segments.length - 1; i >= 0; i--) {
    const parts = segments[i].split(CLAUSE_START);
    const tail = parts[parts.length - 1];
    if (!CLOSURE_ITEM.test(tail.trim())) {
      // 경계 바로 뒤가 비었으면 목록이 거기서 시작한 것이다.
      //   시각 바로 뒤("10:00~18:00, 토, 일, 월 휴관" 의 맨 앞), 괄호 닫힘 뒤("...도슨트), 매주 월요일")
      return tail.trim() === '' && (parts.length > 1 || i === 0) ? extra.join(',') : '';
    }
    extra.unshift(tail);
    if (parts.length > 1 || i === 0) return extra.join(',');
  }
  return extra.join(',');
}

/**
 * 휴관 문구 앞부분에서 닫는 요일을 읽는다. "일, 월, 공휴일 휴관" -> 일·월
 *
 * 요일 글자 바로 앞이 숫자나 다른 한글이면 낱말의 일부이므로 요일로 보지 않는다.
 *   "1월 1일", "12 월 25 일"     -> 날짜의 월·일
 *   "당일", "공휴일", "평일", "매월" -> 요일이 아닌 낱말
 * 다음 경우는 띄어 쓰지 않았어도 요일로 읽는다. 휴관 요일을 놓치면 틀린 "가능"이 나오기 때문이다.
 *   - 뒤에 "요일"이 붙은 경우: "매주월요일", "2, 4 월요일". 날짜의 월·일 뒤에는 "요일"이 오지 않는다
 *   - 앞이 "매주"이거나 "및"·"과"·"와"인 경우: "매주월·화", "공휴일및월"
 *   - 앞 글자도 요일인 경우: "토일", "월화"
 */
function readClosedWeekdays(near: string): Weekday[] {
  const days: Weekday[] = [];
  for (const m of near.matchAll(/[월화수목금토일]/g)) {
    const before = near.slice(0, m.index);
    const after = near.slice(m.index + 1);
    if (/^\s*요일/.test(after) || /(?:매주|[및과와])\s*$/.test(before)) {
      days.push(KO_TO_DAY[m[0]]);
      continue;
    }
    // 숫자 뒤의 월·일은 날짜다. 숫자와 사이에 띄어쓰기가 있어도 같다
    if (/\d\s*$/.test(before)) continue;
    const prev = before.slice(-1);
    if (/[가-힣]/.test(prev) && !/[월화수목금토일]/.test(prev)) continue;
    days.push(KO_TO_DAY[m[0]]);
  }
  return days;
}

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

const ORDINAL_TO_WEEK: Record<string, number> = { 첫: 1, 둘: 2, 두: 2, 셋: 3, 세: 3, 넷: 4, 네: 4, 다섯: 5 };

/**
 * "1, 3째주", "둘째·넷째 주" 처럼 몇째 주인지 읽는다. 없으면 null
 * 숫자 없이 "격주" 라고만 적힌 것은 어느 주인지 알 수 없어 읽지 않는다.
 */
function readWeeksOfMonth(scope: string): number[] | null {
  if (!/째\s*주|주\s*차/.test(scope)) return null;

  const weeks = new Set<number>();
  // "1, 3째주" / "2,4째주" — 째주 앞에 붙은 숫자들을 모은다
  const numeric = /((?:\d\s*[,·]?\s*)+)째\s*주/.exec(scope);
  if (numeric) {
    for (const d of numeric[1].matchAll(/\d/g)) {
      const n = Number(d[0]);
      if (n >= 1 && n <= 5) weeks.add(n);
    }
  }
  // "첫째·셋째 주"
  for (const m of scope.matchAll(/(첫|둘|두|셋|세|넷|네|다섯)\s*째/g)) {
    weeks.add(ORDINAL_TO_WEEK[m[1]]);
  }

  return weeks.size ? [...weeks].sort((a, b) => a - b) : null;
}

/**
 * 연장 운영을 반영한다. 이미 넣어둔 구간의 close 만 바꿔치운다.
 *   "금요일은 21:00까지"           조사가 끼는 경우
 *   "화,수,금,토,일 21:00까지"      요일이 여러 개인 경우
 */
function applyExtensions(weekdays: Record<Weekday, DaySchedule>, source: string): void {
  for (const m of source.matchAll(
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
      // 회차는 시작 시각이 정해져 있어서 마지막 회차를 늘리면 없는 회차를 만들게 된다
      if (cur.sessions) continue;
      const last = cur.intervals[cur.intervals.length - 1];
      if ((toMinutes(close) ?? 0) <= (toMinutes(last.open) ?? 0)) continue;
      weekdays[day] = {
        ...cur,
        intervals: [...cur.intervals.slice(0, -1), { ...last, close }],
        note: EXTENSION_NOTE,
      };
    }
  }
}

/**
 * "9.15.(화)부터 ...", "2024년 4월 12일(금)부터 ..." 처럼
 * 어느 날짜부터 일정이 바뀌는 절을 떼어낸다.
 *
 * 떼어내지 않고 그대로 반영하면 그 날짜 전에도 바뀐 시간이 적용되어,
 * 아직 시작하지 않은 야간개관을 "가능"으로 안내하게 된다.
 */
function splitPeriodClauses(
  text: string,
  year: number,
): { baseText: string; clauses: Array<{ from: string; to?: string; clause: string }> } {
  const clauses: Array<{ from: string; to?: string; clause: string }> = [];
  let baseText = text;
  const ymd = (y: number, mo: number, d: number) =>
    `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const pattern = /(?:(\d{4})\s*[.년]\s*)?(\d{1,2})\s*[.월]\s*(\d{1,2})\s*[.일]?\s*(?:\([월화수목금토일]\))?\s*부터/g;
  // '부터' 바로 뒤에 끝 날짜가 오는 경우. "9.15.(화)부터 12.31.(목)까지 ..."
  //   시각("21:00까지")은 ':' 라서 걸리지 않는다
  const untilDate = /^\s*(?:(\d{4})\s*[.년]\s*)?(\d{1,2})\s*[.월]\s*(\d{1,2})\s*[.일]?\s*(?:\([월화수목금토일]\))?\s*까지/;
  for (const m of text.matchAll(pattern)) {
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    const y = m[1] ? Number(m[1]) : year;

    let rest = text.slice(m.index + m[0].length);
    let head = m[0];
    let to: string | undefined;
    const u = untilDate.exec(rest);
    if (u) {
      const toMo = Number(u[2]);
      const toD = Number(u[3]);
      if (toMo >= 1 && toMo <= 12 && toD >= 1 && toD <= 31) {
        // 연도가 없고 끝 달이 시작 달보다 앞이면 해를 넘긴 것이다 ("11.1.부터 2.28.까지")
        const toY = u[1] ? Number(u[1]) : (toMo < mo ? y + 1 : y);
        to = ymd(toY, toMo, toD);
        head += u[0];
        rest = rest.slice(u[0].length);
      }
    }

    // '부터'(와 끝 날짜) 뒤부터 다음 규칙 경계까지가 그 기간의 설명이다
    const clause = rest.split(/[/;]|※|\*+/)[0];
    if (!clause.trim()) continue;

    clauses.push(to ? { from: ymd(y, mo, d), to, clause } : { from: ymd(y, mo, d), clause });
    baseText = baseText.replace(head + clause, ' ');
  }

  return { baseText, clauses };
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

  // "17:30까지 입장가능", "입장은 17:30까지" 처럼 입장할 수 있는 마지막 시각을 적는 형태.
  //   "21:00까지 운영" 같은 연장 문구와 헷갈리지 않도록 '입장'이 바로 붙어 있을 때만 본다.
  //   폐관보다 늦으면 입장 마감이 아니라 다른 구간의 이야기이므로 버린다
  const until =
    /(\d{1,2}:\d{2})\s*까지\s*(?:만\s*)?입장\s*(?:가능|할\s*수\s*있)/.exec(text)
    ?? /입장\s*(?:은|는|가능\s*시간\s*:?)?\s*(\d{1,2}:\d{2})\s*까지/.exec(text);
  if (until) {
    const t = padTime(until[1]);
    const m = t ? toMinutes(t) : null;
    if (t && m !== null && closeMinutes !== null && m <= closeMinutes) return t;
  }

  return undefined;
}

/**
 * 설날·추석 당일(양력). 음력이라 계산 대신 표로 둔다.
 * 해가 바뀌면 여기에 다음 해를 더한다. 없는 해는 readHolidayClosures 가 null 을 돌려
 * 공휴일 전체 휴관으로 처리된다.
 */
// 설날을 가리키는 말. "설치", "설명" 의 '설'은 아니다
const SEOLLAL = /설날|구정|설(?=\s*(?:[·,]|및|연휴|당일|명절|$))/;

const LUNAR_HOLIDAYS: Record<number, { seollal: string; chuseok: string }> = {
  2025: { seollal: '2025-01-29', chuseok: '2025-10-06' },
  2026: { seollal: '2026-02-17', chuseok: '2026-09-25' },
  2027: { seollal: '2027-02-07', chuseok: '2027-09-15' },
  2028: { seollal: '2028-01-27', chuseok: '2028-10-03' },
};

/**
 * "설·추석 당일 휴관", "설날 및 추석 연휴 휴관" 에서 쉬는 날짜를 읽는다.
 * - '당일'이 있으면 그 날만, 없으면 연휴 3일(전날·당일·다음날)
 * - 전시가 해를 넘길 수 있어 올해와 다음 해를 같이 넣는다
 * 표에 없는 해가 끼면 null (호출하는 쪽이 공휴일 전체 휴관으로 처리한다)
 */
function readHolidayClosures(near: string, year: number): string[] | null {
  const kinds: Array<'seollal' | 'chuseok'> = [];
  if (SEOLLAL.test(near) || /명절/.test(near)) kinds.push('seollal');
  if (/추석|명절/.test(near)) kinds.push('chuseok');
  const onlyTheDay = /당일/.test(near);

  // 같은 문장에 적힌 양력 날짜도 닫는다. "1월 1일, 설날 및 추석 당일 휴관"
  //   예전에는 공휴일 전체를 닫아 1월 1일이 저절로 닫혔으므로, 빼먹으면 틀린 "가능"이 된다
  const solar: Array<[number, number]> = [];
  for (const m of near.matchAll(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)) solar.push([Number(m[1]), Number(m[2])]);
  if (/신정|새해\s*첫날/.test(near)) solar.push([1, 1]);

  const out: string[] = [];
  for (const y of [year, year + 1]) {
    for (const [mo, d] of solar) {
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        out.push(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      }
    }
    const table = LUNAR_HOLIDAYS[y];
    if (!table) return null;
    for (const kind of kinds) {
      const day = table[kind];
      if (onlyTheDay) {
        out.push(day);
        continue;
      }
      const t = new Date(`${day}T00:00:00Z`).getTime();
      for (const offset of [-1, 0, 1]) {
        out.push(new Date(t + offset * 86_400_000).toISOString().slice(0, 10));
      }
    }
  }
  return out;
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

  // "N일부터 일정이 바뀐다"는 절을 떼어낸다. 기본 일정은 그 절 없이 읽는다
  const { baseText, clauses: periodClauses } = splitPeriodClauses(text, year);

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
    // "9.15.(화)부터" 는 하루만의 예외가 아니라 그 날부터 바뀌는 일정이다 (periods 가 담는다)
    if (/^\s*부터/.test(after)) continue;
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
  // session: 구간 바로 앞에 "1회차", "오전반" 같은 말이 붙어 있었는지.
  //   회차는 아무 때나 들어가는 상시 관람이 아니라 시작 시각에 맞춰 가야 하므로 note 로 알린다
  type Assignment = {
    scope: Weekday[] | null;
    interval: TimeInterval;
    weeks: number[] | null;
    session: boolean;
    // 구간 앞에 "하절기", "동절기" 같은 계절 표시가 있었는지
    season: boolean;
  };
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
    // 한 조각 안에서 앞 구간의 요일을 물려받을 때 쓴다
    let scopeInPiece: Weekday[] | null = null;
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
      // "1, 3째주 토 1회차 13:30-15:00 2회차 15:30-17:00" 처럼 한 조각에 회차가 이어지면
      // 앞 구간의 요일을 그대로 쓴다. "(동절기) 10:00~18:00" 같은 계절 안내는 해당하지 않는다
      // 회차·차시·타임은 SESSION_LABEL 과 같이 앞에 번호가 있을 때만 본다 ("타임스퀘어" 제외)
      if (scope === null && scopeInPiece && /[0-9A-Za-z]\s*(?:회차|차시|타임)|부\s*$|반\s*$/.test(scopeText.trim())) {
        scope = scopeInPiece;
      }
      // "주말(하절기) 10:00~19:00 (동절기) 10:00~18:00" 의 동절기는 앞 구간(주말)의 다른 계절 시간이다.
      // 요일을 물려받아 같은 요일에 넣고, 아래에서 두 계절이 겹치는 시간만 남긴다
      const season = SEASON_LABEL.test(scopeText);
      if (scope === null && season) {
        scope = scopeInPiece ?? lastScope;
      }
      if (scope) {
        lastScope = scope;
        scopeInPiece = scope;
      }
      assignments.push({
        scope,
        interval,
        weeks: readWeeksOfMonth(scopeText) ?? readWeeksOfMonth(piece),
        session: SESSION_LABEL.test(scopeText) || EVERY_SESSION.test(piece.slice(cursor)),
        season,
      });
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
  const weeksPerDay = new Map<Weekday, number[]>();
  for (const { scope, interval, weeks } of assignments) {
    if (!scope) continue;
    for (const day of scope) {
      perDay.set(day, [...(perDay.get(day) ?? []), interval]);
      if (weeks && !weeksPerDay.has(day)) weeksPerDay.set(day, weeks);
    }
  }
  // 요일 지정이 없는데 "1, 3째주" 가 적혀 있으면 모든 요일에 적용한다
  const sharedWeeks = assignments.find(a => a.scope === null && a.weeks)?.weeks ?? null;
  // 회차로 적힌 구간. 객체를 그대로 쓰므로 중복 제거 뒤에도 같은 객체로 찾을 수 있다
  const sessionIntervals = new Set(assignments.filter(a => a.session).map(a => a.interval));
  const seasonIntervals = new Set(assignments.filter(a => a.season).map(a => a.interval));

  for (const day of ORDER) {
    const intervals = perDay.get(day) ?? shared;
    // 같은 구간이 두 번 적힌 경우("1회차 14:00~15:30 / 2회차 14:00~15:30")는 하나로 둔다
    const unique = mergeSeasons(
      intervals.filter(
        (iv, i) => intervals.findIndex(other => JSON.stringify(other) === JSON.stringify(iv)) === i,
      ),
      seasonIntervals,
      sessionIntervals,
    );
    if (!unique.length) continue;
    const weeks = weeksPerDay.get(day) ?? (perDay.has(day) ? null : sharedWeeks);
    const schedule: DaySchedule = { isOpen: true, intervals: unique };
    if (weeks) schedule.weeksOfMonth = weeks;
    // 그 요일의 구간이 전부 회차일 때만 붙인다.
    //   "화-일 10:00~18:00 / 토 1회차 14:00~15:00" 의 토요일은 상시 관람도 되므로 붙이지 않는다
    if (unique.every(iv => sessionIntervals.has(iv))) {
      schedule.sessions = true;
      schedule.note = SESSION_NOTE;
    }
    weekdays[day] = schedule;
  }

  // (4) 휴관 선언을 반영해 (3)에서 열어둔 요일을 다시 닫는다
  let holiday: DaySchedule | null = null;
  for (const m of text.matchAll(/(.*?)(?:휴관|휴무)/gs)) {
    // 시간 구간 앞쪽은 운영시간 설명이므로 제외하고, 마지막 시각 뒤부터만 본다
    const before = m[1].replace(/[\s\S]*\d{1,2}:\d{2}/, '');
    const near = before.slice(-20);
    // 요일은 20자 밖으로 이어진 긴 휴관 목록까지 본다.
    // 공휴일·명절은 20자만 본다. 앞 목록의 "당일"이 섞이면 뒤의 "연휴" 3일이 1일로 줄어든다
    const longList = readLongClosureList(before);
    for (const day of readClosedWeekdays(longList ? `${longList},${near}` : near)) {
      weekdays[day] = emptyDay();
    }
    if (/공휴일|국경일/.test(near)) {
      holiday = { isOpen: false, intervals: [] };
    } else if (SEOLLAL.test(near) || /추석|명절/.test(near)) {
      // "설·추석 당일 휴관" 은 그 날만 쉰다는 뜻이다. 공휴일 전체를 닫으면
      // 성탄절·어린이날 같은 다른 공휴일까지 "확실한 휴관"이 되어 버린다
      const dates = readHolidayClosures(near, year);
      if (dates) {
        for (const date of dates) {
          if (!exceptions.some(e => e.date === date)) exceptions.push({ date, schedule: emptyDay() });
        }
      } else {
        // 명절 날짜를 모르는 해면 예전처럼 공휴일 전체를 닫는다. 틀린 "가능"보다 낫다
        holiday = { isOpen: false, intervals: [] };
      }
    }
  }

  // (5) 연장 운영: (3)에서 넣어둔 구간의 close 만 바꿔치운다.
  //    "N일부터" 가 붙은 절은 그 날짜 전에는 적용되지 않으므로 periods 로 따로 뺀다
  applyExtensions(weekdays, baseText);

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

  // (7) 끝 시각만 적혀 있던 날짜 예외를 그 요일 일정으로 채운다. (5) 연장 운영과 같은 규칙이다
  //    "11.5.(목) 22:00까지" -> 목요일이 11:00~19:00 이면 11:00~22:00
  //    - 그 요일 구간은 그대로 두고 마지막 구간의 close 만 늘린다.
  //      첫 여는 시각~끝 시각 한 구간으로 만들면 중간에 쉬는 시간도 "가능"이 된다
  //    - 회차 요일이면 예외를 만들지 않는다. 날짜 예외는 요일 일정보다 먼저 쓰이므로,
  //      회차 표시가 없는 구간을 넣으면 그날만 회차가 아닌 날이 되어 틀린 "가능"이 나온다
  for (const { date, weekday, close } of pendingUntil) {
    const base = weekdays[weekday];
    if (!base.isOpen || !base.intervals.length || base.sessions) continue;
    const last = base.intervals[base.intervals.length - 1];
    const a = toMinutes(last.open);
    const b = toMinutes(close);
    if (a === null || b === null || a >= b) continue;
    const intervals = [...base.intervals.slice(0, -1).map(iv => ({ ...iv })), { ...last, close }];
    exceptions.push({ date, schedule: { isOpen: true, intervals } });
  }

  if (/사전\s*예약|예약\s*필[수요]/.test(text)) {
    for (const d of ORDER) {
      if (weekdays[d].isOpen) weekdays[d] = { ...weekdays[d], requiresReservation: true };
    }
  }

  // (8) "N일부터" 절을 기본 일정 위에 얹어 periods 를 만든다.
  //    그 날짜 이후를 판정할 때는 weekdays 대신 이쪽을 봐야 한다
  const periods: NonNullable<ParsedOperatingHours['periods']> = [];
  for (const { from, to, clause } of periodClauses) {
    const changed = Object.fromEntries(
      ORDER.map(d => [d, { ...weekdays[d], intervals: weekdays[d].intervals.map(iv => ({ ...iv })) }]),
    ) as Record<Weekday, DaySchedule>;

    applyExtensions(changed, clause);
    // "N일부터 월요일 휴관" 처럼 닫는 경우
    for (const m of clause.matchAll(/([월화수목금토일])\s*(?:요일)?[^가-힣]{0,4}(?:휴관|휴무)/g)) {
      changed[KO_TO_DAY[m[1]]] = emptyDay();
    }

    // 기본 일정과 다르지 않으면 넣지 않는다
    if (JSON.stringify(changed) === JSON.stringify(weekdays)) continue;
    periods.push(to ? { from, to, weekdays: changed } : { from, weekdays: changed });
  }

  const result: ParsedOperatingHours = { scheduleType: 'scheduled', weekdays, holiday, exceptions };
  if (periods.length) result.periods = periods;
  return result;
}
