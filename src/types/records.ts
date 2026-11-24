/**
 * 관람 기록(아카이브), 찜(가볼 전시), 공유 평가의 타입.
 * 관람 기록·공유 평가 형식은 schema/personal-records-export.schema.json, schema/shared-reviews-seed.schema.json과 같다.
 * 찜은 내보내지 않아 스키마가 없다(브라우저 localStorage에만 있다).
 * 기록을 읽고 저장하고 내보내는 함수는 src/lib/archive.ts에, 찜은 src/lib/saved.ts에 있다.
 */

/**
 * 기록할 때 전시 정보를 복사해 둔 것.
 * 끝난 전시는 수집할 때 auto.json에서 빠지므로, 카탈로그에서 못 찾아도 기록을 보여 주려고 둔다.
 */
export interface ExhibitionSnapshot {
  title: string;
  // displayVenueName(entry) 결과. 모르면 null
  venueName: string | null;
  // 연결된 시설 id (venue-*). 공유 평가를 시설 단위로 볼 때 쓴다
  venueId: string | null;
  // 서울시 대분류 (전시/미술, 교육/체험 …)
  field: string | null;
  imageUrl: string | null;
  // 전시 기간 YYYY-MM-DD. 카탈로그에서 빠졌을 때 끝난 전시인지 가르는 데 쓴다. 모르면 null
  start: string | null;
  end: string | null;
}

/** 관람 기록 한 건 */
export interface VisitRecord {
  id: string;
  // 전시 id (auto.json의 id)
  exhibitionId: string;
  exhibition: ExhibitionSnapshot;
  // 관람일 YYYY-MM-DD
  date: string;
  // 1~5 정수
  rating: number;
  // 실제 관람 시간(분), 10~480 정수
  visitMinutes: number;
  // 개인 메모. 빈 문자열 허용. 공유하지 않는다
  note: string;
  // 별점·관람 시간·태그 익명 공유 동의
  shared: boolean;
  // 기록을 만든 시각, ISO 8601
  createdAt: string;
  // 사용자 태그 (src/lib/userTags.ts의 normalizeTags를 거친 값, 최대 5개). 태그가 없으면 필드를 두지 않는다.
  // 공유에 동의한 기록이면 익명으로 서버에 보낸다. #71의 주제 태그(src/lib/tags.ts)와 다르다
  tags?: string[];
}

/** 저장 형식 버전. 형식이 바뀌면 올리고 src/lib/archive.ts에서 예전 형식을 옮긴다 */
export const ARCHIVE_VERSION = 2;

/** localStorage에 저장하는 아카이브 전체 */
export interface ArchiveData {
  version: typeof ARCHIVE_VERSION;
  records: VisitRecord[];
  // 관심 분야. 값은 전시의 field와 같은 종류
  interests: string[];
}

// ─── 찜(가볼 전시) ─────────────────────────────────────────
// 읽고 저장하는 함수는 src/lib/saved.ts에 있다. 아카이브와 다른 키(onjeonsi:saved)에 저장한다.

/** 찜 저장 형식 버전. 아카이브(ARCHIVE_VERSION)와 따로 센다 */
export const SAVED_VERSION = 1;

/** 찜한 전시 한 건 */
export interface SavedItem {
  // 전시 id (auto.json의 id)
  exhibitionId: string;
  // 찜한 시각, ISO 8601
  savedAt: string;
  // 찜할 때 복사해 둔 전시 정보. 끝난 전시가 카탈로그에서 빠져도 목록에 보여 주려고 둔다
  exhibition: ExhibitionSnapshot;
}

/** localStorage에 저장하는 찜 목록 전체 */
export interface SavedData {
  version: typeof SAVED_VERSION;
  // 찜한 순서 (먼저 찜한 것이 앞)
  items: SavedItem[];
}

/** 내보내기 파일. 저장 형식에 내보낸 시각을 더한 것 */
export interface ArchiveExport extends ArchiveData {
  // ISO 8601
  exportedAt: string;
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
