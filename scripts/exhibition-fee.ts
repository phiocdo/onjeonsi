/**
 * 서울시 API의 요금 정보(IS_FREE, USE_FEE)를 전시 필드(isFree, fee)로 옮긴다.
 *
 * - IS_FREE가 '무료'면 isFree: true, '유료'면 false. 앞뒤 공백만 지운다.
 *   그 밖의 값이나 빈 값이면 isFree를 두지 않는다. 필드가 없으면 "모름"이지 "무료"가 아니다.
 *   예상 밖 값은 unexpected로 돌려주어 수집 로그에 남긴다.
 * - USE_FEE는 앞뒤 공백만 지운 원문을 fee에 넣는다. 빈 값이면 fee를 두지 않는다.
 *   금액을 숫자로 바꾸거나, fee 문구로 isFree를 추측하지 않는다(서로 어긋나도 그대로 둔다).
 *   FEE_MAX자를 넘으면 앞 FEE_MAX-1자 + '…'로 자른다(스키마 검사 실패로 수집 전체가 되돌아가지 않게).
 */

/** fee 최대 길이(문자 = 코드 포인트 단위). schema/exhibitions.schema.json의 fee maxLength와 같은 값이어야 한다 */
export const FEE_MAX = 1000;

export interface ParsedFee {
  isFree?: boolean;
  fee?: string;
  /** '무료'·'유료'·빈 값이 아닌 IS_FREE 원문(trim). 저장하지 않고 로그에만 쓴다 */
  unexpected?: string;
  /** fee를 FEE_MAX자로 잘랐으면 true. 저장하지 않고 로그에만 쓴다 */
  truncated?: true;
}

/**
 * 코드 포인트 단위로 자른다. ajv의 maxLength도 코드 포인트로 세고,
 * UTF-16 단위로 자르면 이모지 같은 서로게이트 쌍이 반쪽만 남을 수 있다.
 */
function truncateFee(fee: string): { text: string; truncated: boolean } {
  const chars = Array.from(fee);
  if (chars.length <= FEE_MAX) return { text: fee, truncated: false };
  return { text: chars.slice(0, FEE_MAX - 1).join('') + '…', truncated: true };
}

export function parseFee(isFreeRaw: string | undefined, useFeeRaw: string | undefined): ParsedFee {
  const result: ParsedFee = {};

  const isFreeText = (isFreeRaw ?? '').trim();
  if (isFreeText === '무료') result.isFree = true;
  else if (isFreeText === '유료') result.isFree = false;
  else if (isFreeText !== '') result.unexpected = isFreeText;

  const fee = (useFeeRaw ?? '').trim();
  if (fee !== '') {
    const { text, truncated } = truncateFee(fee);
    result.fee = text;
    if (truncated) result.truncated = true;
  }

  return result;
}

/** 전시 객체에 펼쳐 넣을 필드만(isFree, fee). unexpected는 저장하지 않는다 */
export function feeFields(isFreeRaw: string | undefined, useFeeRaw: string | undefined): Pick<ParsedFee, 'isFree' | 'fee'> {
  const { isFree, fee } = parseFee(isFreeRaw, useFeeRaw);
  return { ...(isFree !== undefined ? { isFree } : {}), ...(fee !== undefined ? { fee } : {}) };
}

/** 예상 밖 IS_FREE 값을 로그에 몇 개까지 보여줄지 */
const MAX_EXAMPLES = 3;

/**
 * 수집 로그용 요금 집계.
 * - info: "요금: 무료 N건 / 유료 N건 / 정보 없음 N건" (정보 없음 = isFree를 두지 않은 전시, 예상 밖 값 포함)
 * - warning: 예상 밖 IS_FREE 값이 있을 때(건수와 서로 다른 값 예시 최대 3개),
 *   요금 문구를 자른 전시가 있을 때. 둘 다 있으면 줄바꿈으로 잇는다. 없으면 null
 */
export function summarizeFees(rows: readonly { IS_FREE?: string; USE_FEE?: string }[]): {
  info: string;
  warning: string | null;
} {
  let free = 0;
  let paid = 0;
  let unknown = 0;
  let unexpectedCount = 0;
  let truncatedCount = 0;
  const examples: string[] = [];

  for (const row of rows) {
    const { isFree, unexpected, truncated } = parseFee(row.IS_FREE, row.USE_FEE);
    if (truncated) truncatedCount++;
    if (isFree === true) free++;
    else if (isFree === false) paid++;
    else unknown++;

    if (unexpected !== undefined) {
      unexpectedCount++;
      if (examples.length < MAX_EXAMPLES && !examples.includes(unexpected)) examples.push(unexpected);
    }
  }

  const info = `   요금: 무료 ${free}건 / 유료 ${paid}건 / 정보 없음 ${unknown}건`;
  const warnings: string[] = [];
  if (unexpectedCount) {
    warnings.push(
      `⚠️ 예상 밖 IS_FREE 값 ${unexpectedCount}건 (정보 없음으로 둠): ${examples.map((v) => JSON.stringify(v)).join(', ')}`,
    );
  }
  if (truncatedCount) warnings.push(`⚠️ 요금 문구를 ${FEE_MAX}자로 자른 전시: ${truncatedCount}건`);
  const warning = warnings.length ? warnings.join('\n') : null;
  return { info, warning };
}
