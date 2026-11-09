/** 판정 사유 문구. 판정 함수, 목 데이터, 화면이 같은 문구를 쓰도록 이 파일에서만 정의한다. */
export const REASONS = {
  OUT_OF_PERIOD: '전시 기간이 아닙니다',
  CLOSED_DATE: '임시 휴관일입니다',
  CLOSED_WEEKDAY: (weekdayLabel: string) => `${weekdayLabel}요일 휴관입니다`,
  CLOSED_HOLIDAY: '공휴일 휴관입니다',
  AFTER_LAST_ENTRY: (lastEntry: string) => `입장 마감(${lastEntry}) 이후입니다`,
  NOT_ENOUGH_BEFORE_CLOSE: '폐관 전까지 관람 시간이 부족합니다',
  NOT_ENOUGH_STAY: '머물 수 있는 시간 안에 관람을 마칠 수 없습니다',
  MISSING_HOURS: '운영 시간 정보가 없습니다',
  MISSING_LAST_ENTRY: '입장 마감 정보가 없습니다',
  NOT_IMPLEMENTED: '판정 로직 구현 전입니다',
} as const;