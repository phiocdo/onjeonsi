/**
 * 서울시 문화행사 API에서 수집할 행사를 고른다: 종로구·중구에서 열리는 전시.
 *
 * 전시인지는 서울시 분류(CODENAME)로만 본다. 예전에는 분류가 전시가 아니어도 장소에
 * 미술관·박물관·갤러리·DDP가 있으면 모았는데, 그렇게 들어온 것은 전시가 아니었다.
 * 2026-11-25 API 전체(19,775건)로 확인한 것:
 * - 진행 중인 44건 중 장소 조건으로만 들어온 12건이 모두 비전시였다.
 *   교육/체험 8(전시 연계 강연·외국어 해설·DDP 투어·학교 모집 공고), 콘서트 2(30분 런치 스테이지), 영화 2
 * - 이들은 운영시간이 회차·하루 행사라 판정이 틀리기 쉽다. 모집 공고가 '가능'으로,
 *   30분 공연이 관람 60분 기본값 때문에 '불가'로 나왔다.
 * - 반대로 분류는 전시가 아닌데 제목에 '전시·展·기획전' 같은 말이 있는 행사는
 *   지난 것까지 207건이었는데, 전시 연계 강연·체험·모집 공고였고 놓치는 전시는 없었다.
 */

/** 서울시 API 행사 한 건에서 고를 때 보는 칸 */
export interface EventFields {
  GUNAME?: string;
  CODENAME?: string;
}

/** 종로구·중구 행사인지 */
export function isTargetGu(guname: string | undefined): boolean {
  const gu = (guname ?? '').trim();
  return gu.includes('종로구') || gu.includes('중구');
}

/** 서울시 분류가 전시인지. 지금 분류 값 중에는 '전시/미술' 하나만 해당한다 */
export function isExhibitionCode(codename: string | undefined): boolean {
  const code = (codename ?? '').trim();
  return code.includes('전시') || code.includes('미술');
}

/** 수집할 행사인지: 종로구·중구 + 전시 분류 */
export function isTargetEvent(item: EventFields): boolean {
  return isTargetGu(item.GUNAME) && isExhibitionCode(item.CODENAME);
}
