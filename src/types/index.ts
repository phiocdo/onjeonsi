export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface Venue {
  id: string;
  name: string;
  aliases: string[];
  gu: '종로구' | '중구';
  type: '미술관' | '박물관';
  lat: number;
  lng: number;
  representative: boolean;
  hours?: Partial<Record<Weekday, { open: string; close: string }>>;
  closed?: { weekday?: Weekday; ifHoliday?: 'nextDay'; dates?: string[] };
  lastEntry?: string;
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
  note?: string; // "야간개관", "오픈식" 같은 짧은 메시지
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
}
