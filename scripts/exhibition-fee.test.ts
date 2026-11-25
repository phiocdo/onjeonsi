import { describe, it, expect } from 'vitest';
import { parseFee, feeFields, summarizeFees, FEE_MAX } from './exhibition-fee';

/** 코드 포인트 수(ajv maxLength가 세는 방식) */
const charCount = (s: string) => Array.from(s).length;
/** 짝 없는 서로게이트(깨진 글자) */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('parseFee — IS_FREE', () => {
  it("'무료'는 isFree: true", () => {
    expect(parseFee('무료', undefined)).toEqual({ isFree: true });
  });

  it("'유료'는 isFree: false", () => {
    expect(parseFee('유료', undefined)).toEqual({ isFree: false });
  });

  it('앞뒤 공백은 지우고 읽는다', () => {
    expect(parseFee(' 무료 ', undefined)).toEqual({ isFree: true });
  });

  it('빈 값·undefined면 필드를 두지 않는다', () => {
    expect(parseFee('', '')).toEqual({});
    expect(parseFee('   ', undefined)).toEqual({});
    expect(parseFee(undefined, undefined)).toEqual({});
    expect('isFree' in parseFee(undefined, undefined)).toBe(false);
  });

  it('예상 밖 값이면 isFree를 두지 않고 unexpected로 돌려준다', () => {
    expect(parseFee('무료(일부 유료)', undefined)).toEqual({ unexpected: '무료(일부 유료)' });
    expect(parseFee(' 기타 ', undefined)).toEqual({ unexpected: '기타' });
  });
});

describe('parseFee — USE_FEE', () => {
  it('앞뒤 공백만 지우고 원문 그대로 둔다', () => {
    expect(parseFee('유료', '  성인 5,000원 / 청소년 3,000원 ')).toEqual({
      isFree: false,
      fee: '성인 5,000원 / 청소년 3,000원',
    });
  });

  it('빈 USE_FEE면 fee를 두지 않는다', () => {
    expect(parseFee('유료', '')).toEqual({ isFree: false });
    expect(parseFee('유료', '  ')).toEqual({ isFree: false });
  });

  it("isFree가 true인데 fee에 '원'이 있어도 그대로 둔다(추측하지 않는다)", () => {
    expect(parseFee('무료', '성인 3,000원')).toEqual({ isFree: true, fee: '성인 3,000원' });
  });

  it('IS_FREE가 없어도 fee 문구로 isFree를 추측하지 않는다', () => {
    expect(parseFee('', '무료')).toEqual({ fee: '무료' });
  });
});

describe('parseFee — USE_FEE 길이 제한', () => {
  it('FEE_MAX는 1000(스키마 maxLength와 같은 값)', () => {
    expect(FEE_MAX).toBe(1000);
  });

  it('1000자는 그대로 통과하고 truncated를 두지 않는다', () => {
    const fee = '가'.repeat(1000);
    const result = parseFee('유료', fee);
    expect(result).toEqual({ isFree: false, fee });
    expect('truncated' in result).toBe(false);
  });

  it('1001자는 앞 999자 + …로 1000자가 되고 truncated: true', () => {
    const result = parseFee('유료', 'a'.repeat(1001));
    expect(result.fee).toBe('a'.repeat(999) + '…');
    expect(charCount(result.fee!)).toBe(1000);
    expect(result.fee!.endsWith('…')).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it('앞뒤 공백을 지운 뒤 길이를 잰다', () => {
    const fee = '가'.repeat(1000);
    expect(parseFee('유료', `  ${fee}  `)).toEqual({ isFree: false, fee });
  });

  it('한글은 글자 단위로 자른다', () => {
    const result = parseFee('유료', '가나다'.repeat(400)); // 1200자
    expect(charCount(result.fee!)).toBe(1000);
    expect(result.fee).toBe('가나다'.repeat(400).slice(0, 999) + '…');
    expect(result.truncated).toBe(true);
  });

  it('이모지(서로게이트 쌍)가 경계에 걸려도 반쪽이 남지 않는다', () => {
    // 999번째 글자가 이모지: UTF-16 단위로 999개를 자르면 상위 서로게이트만 남는다
    const raw = 'a'.repeat(998) + '😀😀😀';
    expect(LONE_SURROGATE.test(raw.slice(0, 999))).toBe(true); // 비교: 잘못 자르면 깨진다
    const result = parseFee('유료', raw);
    expect(result.fee).toBe('a'.repeat(998) + '😀…');
    expect(charCount(result.fee!)).toBe(1000);
    expect(LONE_SURROGATE.test(result.fee!)).toBe(false);
    expect(result.truncated).toBe(true);
  });

  it('이모지 1000개는 문자 수로 1000이라 자르지 않는다(UTF-16 길이 2000이어도)', () => {
    const fee = '😀'.repeat(1000);
    expect(parseFee('유료', fee)).toEqual({ isFree: false, fee });
  });
});

describe('feeFields', () => {
  it('unexpected는 빼고 isFree·fee만 돌려준다', () => {
    expect(feeFields('무료(일부 유료)', ' 1,000원 ')).toEqual({ fee: '1,000원' });
    expect(feeFields('무료', '')).toEqual({ isFree: true });
    expect(feeFields(undefined, undefined)).toEqual({});
  });

  it('잘랐어도 truncated는 빼고 isFree·fee만 돌려준다', () => {
    expect(feeFields('유료', 'a'.repeat(1001))).toEqual({ isFree: false, fee: 'a'.repeat(999) + '…' });
  });
});

describe('summarizeFees', () => {
  it('무료·유료·정보 없음을 센다. 예상 밖 값은 정보 없음에 들어간다', () => {
    const { info, warning } = summarizeFees([
      { IS_FREE: '무료', USE_FEE: '' },
      { IS_FREE: '유료', USE_FEE: '5,000원' },
      { IS_FREE: '유료' },
      { IS_FREE: '' },
      { IS_FREE: '무료(일부 유료)' },
    ]);
    expect(info).toContain('무료 1건 / 유료 2건 / 정보 없음 2건');
    expect(warning).toContain('1건');
    expect(warning).toContain('"무료(일부 유료)"');
  });

  it('예상 밖 값이 없으면 warning은 null', () => {
    expect(summarizeFees([{ IS_FREE: '무료' }]).warning).toBeNull();
  });

  it('예시는 서로 다른 값으로 최대 3개, 건수는 전부 센다', () => {
    const rows = ['가', '가', '나', '다', '라'].map((v) => ({ IS_FREE: v }));
    const { warning } = summarizeFees(rows);
    expect(warning).toContain('5건');
    expect(warning).toContain('"가", "나", "다"');
    expect(warning).not.toContain('"라"');
  });

  it('요금 문구를 자른 전시 수를 경고로 남긴다', () => {
    const { warning } = summarizeFees([
      { IS_FREE: '유료', USE_FEE: 'a'.repeat(1001) },
      { IS_FREE: '유료', USE_FEE: '가'.repeat(2000) },
      { IS_FREE: '유료', USE_FEE: 'a'.repeat(1000) },
    ]);
    expect(warning).toBe('⚠️ 요금 문구를 1000자로 자른 전시: 2건');
  });

  it('예상 밖 IS_FREE와 자른 문구가 함께 있으면 두 줄로 남긴다', () => {
    const { warning } = summarizeFees([
      { IS_FREE: '기타', USE_FEE: 'a'.repeat(1001) },
    ]);
    expect(warning!.split('\n')).toEqual([
      '⚠️ 예상 밖 IS_FREE 값 1건 (정보 없음으로 둠): "기타"',
      '⚠️ 요금 문구를 1000자로 자른 전시: 1건',
    ]);
  });

  it('자른 전시가 0건이면 자른 경고를 출력하지 않는다', () => {
    const { warning } = summarizeFees([{ IS_FREE: '유료', USE_FEE: 'a'.repeat(1000) }]);
    expect(warning).toBeNull();
  });
});
