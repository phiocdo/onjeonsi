import { createHash } from 'crypto';

/**
 * 전시 id를 만든다.
 *
 * 수집할 때마다 같은 전시에 같은 id가 나와야 한다. 공유 링크(`#/overview/<id>`)와
 * 별점·관람 기록이 id로 전시를 찾기 때문이다. 그래서 목록에서 몇 번째인지가
 * 아니라 전시 자체에서 끌어낸다.
 *
 * 1순위는 서울시가 매긴 `cultcode`다. `HMPG_ADDR`(문화포털 상세 주소)의
 * 질의 문자열에 들어 있다.
 *   https://culture.seoul.go.kr/.../view.do?cultcode=160056&menuNo=200009
 * 전체 19,743건을 세어 보면 빠진 것 0건, 겹치는 것 0건이다. 제목이나 장소가
 * 수정되어도 그대로라서 해시보다 낫다.
 *
 * 2순위는 제목·장소·시작일을 해시한 값이다. 지금은 cultcode가 없는 전시가
 * 없지만, 주소 형식이 바뀌면 여기로 넘어온다.
 *   - 제목만으로는 모자라다. 정기 프로그램이 같은 제목으로 반복 등록되어,
 *     2,299건 중 제목이 겹치는 것이 28종류 72건이다.
 *       5회  [서울갤러리] 런치 스테이지 [하모니시스트 이한결]
 *       3회  동대문 역사관 (2023·2024·2025 매년)
 *     장소와 시작일을 붙이면 2,299건이 전부 고유해진다.
 *   - 그 셋을 주소에 그대로 넣을 수는 없어 해시한다. 제목에 `#`과 `&`가 든
 *     전시가 있고(HashRouter 주소에서 `#`은 경로를 끊는다), 한글이 퍼센트
 *     인코딩되면 주소가 평균 192자, 최대 379자가 된다.
 *   - 이 경로로 만든 id는 제목이나 장소가 수정되면 바뀐다. 그 전시가 사라지고
 *     새 전시가 생긴 것처럼 보인다.
 */
export function makeExhibitionId(exhibition: {
  // 서울시 API가 비워서 보내는 경우를 타입에도 남겨 둔다.
  // 타입을 string 으로만 두면 아래 `?? ''` 가 죽은 코드처럼 보여 지워질 수 있다
  title: string | null | undefined;
  placeName: string | null | undefined;
  start: string | null | undefined;
  detailUrl?: string | null | undefined;
}): string {
  const cultcode = readCultcode(exhibition.detailUrl);
  if (cultcode) return `auto-seoul-${cultcode}`;

  const key = [exhibition.title, exhibition.placeName, exhibition.start]
    .map(part => (part ?? '').trim())
    .join('|');

  // 16진수 12자 = 48비트. 8자(32비트)는 수천 건 규모에서 충돌 확률이 무시하기 어렵다
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 12);
  return `auto-seoul-${hash}`;
}

/** 문화포털 상세 주소에서 cultcode 값을 꺼낸다. 없으면 null */
export function readCultcode(detailUrl: string | null | undefined): string | null {
  const matched = /[?&]cultcode=(\d+)/.exec(detailUrl ?? '');
  return matched ? matched[1] : null;
}

/**
 * 같은 id를 가진 전시가 있는지 찾는다.
 *
 * 같은 cultcode가 두 번 오거나, cultcode가 없는 전시 둘의 제목·장소·시작일이
 * 전부 같으면 id가 겹친다. 스키마로는 id 중복을 검사할 수 없으므로
 * (`schema/README.md`) 수집할 때 확인한다.
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
