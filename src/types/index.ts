export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface Venue {
  id: string;
  name: string;
  aliases: string[];
  gu: '종로구' | '중구';
  type: '미술관' | '박물관';
  lat: number;
  lng: number;
  // 카카오맵 장소 ID. 있으면 상세 창 카카오맵 링크가 장소 페이지(place.map.kakao.com/{id})로 간다 ex) '17952661'
  kakaoPlaceId?: string;
  representative: boolean;
  hours?: Partial<Record<Weekday, { open: string; close: string }>>;
  // ifHoliday: 휴관 요일이 공휴일이면 연다. nextDay는 다음 날 대체 휴관, open은 대체 휴관 없음
  closed?: { weekday?: Weekday; ifHoliday?: 'nextDay' | 'open'; dates?: string[] };
  // 공휴일이고 그날 열면 이 요일의 운영시간·입장 마감을 쓴다 ex) 'sun'
  holidayAs?: Weekday;
  lastEntry?: string;
  // 입장 마감 = 그날 폐관 − N분. 있으면 lastEntry보다 우선한다 ex) 60
  lastEntryBeforeClose?: number;
  visitMinutes?: number;
  docent?: { days: Weekday[]; times: string[] }[];
  entry?: string;
  reservation?: string;
  source: string;
  verified: string;
}

// 하루 안의 한 구간. 브레이크 타임이나 회차가 있으면 구간이 여러 개가 된다
export interface TimeInterval {
  // HH:mm 형식
  open: string;
  close: string;
  // 입장 마감 시각. "종료 30분 전 입장마감" 같은 문구는 계산해서 넣는다
  lastAdmission?: string;
}

export interface DaySchedule {
  isOpen: boolean;
  intervals: TimeInterval[]; // 휴관일이면 빈 배열
  requiresReservation?: boolean;
  note?: string; // "야간개관", "오픈식" 같은 짧은 메시지. 화면 표시용이라 판정에 쓰지 않는다
  /**
   * 회차로만 운영하는 날이면 true. "1회차 14:00~15:20 / 2회차 16:00~17:20" 같은 경우다.
   * 이때 intervals 는 관람 가능한 시간대가 아니라 각 회차의 시작~끝이다.
   * 상시 관람 구간이 하나라도 섞인 날은 붙지 않는다.
   *
   * 판정할 때 note 문자열 대신 이 값을 본다.
   */
  sessions?: boolean;
  /**
   * 그 달의 몇째 주에만 하는 경우. [1, 3] 이면 1·3째주만 열고 나머지 주는 닫는다.
   * 없으면 매주 한다는 뜻이다. "1, 3째주 토 ..." 같은 격주 프로그램에서 나온다.
   *
   * 판정하는 쪽에서 이 값을 보지 않으면 격주 프로그램을 매주 하는 것으로 읽어
   * 쉬는 주에 "가능"이 나온다.
   */
  weeksOfMonth?: number[];
}

/**
 * 전시의 운영시간을 요일별로 푼 것. 서울시 API의 PRO_TIME 문구를 파싱해 만든다.
 * 시설 운영시간(Venue.hours)과는 다른 값이다 ex) 시설이 열려도 전시가 안 할 수 있다.
 */
export interface ParsedOperatingHours {
  // scheduled: 시각 판정 가능, always_open: 상시, unknown: 문구로 판별 불가
  scheduleType: 'scheduled' | 'always_open' | 'unknown';
  weekdays: Record<Weekday, DaySchedule>;
  holiday: DaySchedule | null; // 공휴일 규칙이 따로 적힌 경우만. 언급이 없으면 null
  exceptions: Array<{ date: string; schedule: DaySchedule }>; // "11.17(화) 오픈식 14:00~16:00"처럼 특정 날짜만 다른 경우
  /**
   * 어느 날짜부터 요일별 일정이 바뀌는 경우.
   *   "9.15.(화)부터 화,수,금,토,일 21:00까지"
   *   "2024년 4월 12일(금)부터 매주 금요일은 21:00까지 야간개관합니다"
   *
   * 판정하려는 날짜가 `from` 이후(그리고 `to` 이전)면 위의 `weekdays` 대신
   * 여기 있는 `weekdays` 를 쓴다. 날짜가 최근 순이 아니므로 호출하는 쪽에서
   * 조건에 맞는 것 중 가장 늦은 `from` 을 골라야 한다.
   */
  periods?: Array<{
    from?: string; // YYYY-MM-DD. 없으면 처음부터
    to?: string; // YYYY-MM-DD. 없으면 끝까지
    weekdays: Record<Weekday, DaySchedule>;
  }>;
}

export interface Exhibition {
  id: string;
  venueId: string;
  title: string;
  start: string;
  end: string;
  field?: string;
  placeName?: string;
  hoursText?: string; // 운영시간 원문 (서울시 API PRO_TIME)
  operatingHours?: ParsedOperatingHours; // hoursText를 요일별로 푼 것
  link?: string; // 기관 홈페이지 (서울시 API ORG_LINK)
  imageUrl?: string; // 대표 이미지 (MAIN_IMG)
  detailUrl?: string; // 서울문화포털 상세 페이지 (HMPG_ADDR)
  lat?: number;
  lng?: number;
  isFree?: boolean; // 무료면 true, 유료면 false (서울시 API IS_FREE). 없으면 모름 — 무료가 아니다
  fee?: string; // 요금 문구 원문 (USE_FEE). isFree와 어긋날 수 있다
  fetchedAt?: string;
}

export interface JudgeInput {
  venue: Venue;
  exhibition: Exhibition;
  date: string;
  stayStart: string;
  stayEnd: string;
  holidays: string[];
}

export interface JudgeResult {
  result: 'possible' | 'impossible' | 'unknown';
  reasons: string[];
  entryTime?: string;
  endTime?: string;
  slackMinutes?: number;
  // 판정 근거: 시설 정보만(venue), 전시 운영시간만(exhibition), 둘을 합친 것(merged)
  basis?: 'venue' | 'exhibition' | 'merged';
  // 그날 입장 마감 정보가 없어 폐관 시각을 입장 마감으로 보고 판정했으면 true.
  // 입장 마감이 데이터에 있으면 넣지 않는다
  lastEntryAssumed?: true;
}
