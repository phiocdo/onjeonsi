import { createHash } from 'crypto';

/**
 * 전시 id를 만든다.
 *
 * 수집할 때마다 같은 전시에 같은 id가 나와야 한다. 공유 링크(`#/overview/<id>`)와
 * 별점·관람 기록이 id로 전시를 찾기 때문이다.
 * 그래서 목록에서 몇 번째인지가 아니라 전시의 내용으로 만든다.
 *
 * 제목만으로는 모자란다. 정기 프로그램이 같은 제목으로 반복 등록되어,
 * 종료된 전시까지 2,299건을 세어 보면 제목이 겹치는 것이 28종류 72건이다.
 *   5회  [서울갤러리] 런치 스테이지 [하모니시스트 이한결]
 *   3회  동대문 역사관 (2023·2024·2025 매년)
 * 장소와 시작일을 붙이면 2,299건이 전부 고유해진다.
 *
 * 해시를 거치는 이유는 두 가지다.
 *   - 제목에 `#`과 `&`가 든 전시가 있다. HashRouter 주소에서 `#`은 경로를 끊는다.
 *   - 한글이 퍼센트 인코딩되면 주소가 평균 192자, 최대 379자가 된다.
 *
 * 한계: 서울시 쪽에서 제목이나 장소를 고치면 id도 바뀌어, 그 전시가 사라지고
 * 새 전시가 생긴 것처럼 보인다. 수집 시각을 넣지 않는 이유도 같다 (매번 달라진다).
 */
export function makeExhibitionId(exhibition: {
  title: string;
  placeName: string;
  start: string;
}): string {
  const key = [exhibition.title, exhibition.placeName, exhibition.start]
    .map(part => (part ?? '').trim())
    .join('|');

  // 16진수 12자 = 48비트. 8자(32비트)는 수천 건 규모에서 충돌 확률이 무시하기 어렵다
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 12);
  return `auto-seoul-${hash}`;
}

/**
 * 같은 id를 가진 전시가 있는지 찾는다.
 *
 * 제목·장소·시작일이 전부 같은 전시가 두 건 올라오면 id도 같아진다.
 * 스키마로는 id 중복을 검사할 수 없으므로(`schema/README.md`) 수집할 때 확인한다.
 */
export function findDuplicateIds(exhibitions: { id: string }[]): string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();

  for (const { id } of exhibitions) {
    if (seen.has(id)) duplicated.add(id);
    seen.add(id);
  }

  return [...duplicated];
}
