/**
 * 관람 기록과 공유 평가의 타입.
 * 형식은 schema/personal-records-export.schema.json, schema/shared-reviews-seed.schema.json과 같다.
 */

/** 관람 기록 한 건. 필드 이름은 아카이브 화면(src/pages/Archive.tsx)을 따른다 */
export interface VisitRecord {
  id: string;
  // 전시 id. 목 데이터는 숫자지만 저장 형식은 문자열이다
  exhibitId: string;
  // YYYY-MM-DD
  date: string;
  // 1~5 정수
  rating: number;
  // 실제 관람 시간(분), 10~480
  time: number;
  // 개인 메모. 빈 문자열 허용
  note: string;
  shared: boolean;
}

/** 공유 평가 시드(data/reviews/seed.json)의 원소. rating·visitMinutes는 src/engine/stats.ts의 ReviewInput과 같다 */
export interface SharedReview {
  exhibitionId: string;
  // 시설 id (venue-*)
  venueId: string;
  // 1~5 정수
  rating: number;
  // 10~480
  visitMinutes: number;
}
