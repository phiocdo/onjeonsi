import { describe, expect, it } from 'vitest';
import { MAX_TAGS, SUGGESTED_TAGS, normalizeTag, normalizeTags, pickKeywords } from './userTags';

describe('normalizeTag', () => {
  it("맨 앞 '#'을 뗀다", () => {
    expect(normalizeTag('#사진맛집')).toBe('사진맛집');
    expect(normalizeTag('##사진맛집')).toBe('사진맛집');
  });

  it('앞뒤 공백을 지우고 공백 여러 개를 하나로', () => {
    expect(normalizeTag('  조용  함 ')).toBe('조용 함');
    expect(normalizeTag('조용\t\n함')).toBe('조용 함');
  });

  it("한글·영문·숫자·공백·'·' 외 문자는 지우고 영문은 소문자로", () => {
    expect(normalizeTag('Date!! 코스😀')).toBe('date 코스');
    expect(normalizeTag('회화·수묵')).toBe('회화·수묵');
    expect(normalizeTag('a - b')).toBe('a b');
    expect(normalizeTag('2층')).toBe('2층');
  });

  it('15자까지 받고 16자는 null', () => {
    expect(normalizeTag('가'.repeat(15))).toBe('가'.repeat(15));
    expect(normalizeTag('가'.repeat(16))).toBeNull();
    // 지워진 문자는 세지 않는다
    expect(normalizeTag(`${'가'.repeat(15)}!!!`)).toBe('가'.repeat(15));
  });

  it('비었거나 글자가 없으면 null', () => {
    expect(normalizeTag('')).toBeNull();
    expect(normalizeTag('   ')).toBeNull();
    expect(normalizeTag('#')).toBeNull();
    expect(normalizeTag('!!!')).toBeNull();
    expect(normalizeTag('···')).toBeNull();
    expect(normalizeTag(3)).toBeNull();
  });

  it('풀린 한글 자모(NFD)는 합쳐서 센다', () => {
    expect(normalizeTag('조용함'.normalize('NFD'))).toBe('조용함');
  });

  it('추천 태그는 정리해도 그대로다', () => {
    for (const tag of SUGGESTED_TAGS) expect(normalizeTag(tag)).toBe(tag);
  });
});

describe('normalizeTags', () => {
  it('6개면 앞에서부터 5개', () => {
    expect(normalizeTags(['a', 'b', 'c', 'd', 'e', 'f'])).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(MAX_TAGS).toBe(5);
  });

  it('정리한 뒤 중복·빈 값을 지운다 (지운 것은 5개에 세지 않는다)', () => {
    expect(normalizeTags(['#조용함', '조용함', ' 조용함 ', '', '!!', 'Date', 'date', 'a', 'b', 'c', 'd'])).toEqual([
      '조용함',
      'date',
      'a',
      'b',
      'c',
    ]);
  });

  it('배열이 아니면 빈 배열, 문자열 아닌 원소는 버린다', () => {
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags('조용함')).toEqual([]);
    expect(normalizeTags([1, null, '조용함'])).toEqual(['조용함']);
  });
});

describe('pickKeywords', () => {
  it('사용자 태그를 users 많은 순으로 먼저, 모자라면 주제 태그로 채운다 (최대 4개)', () => {
    const picked = pickKeywords(
      [
        { tag: '조용함', users: 2 },
        { tag: '사진 찍기 좋음', users: 5 },
      ],
      ['현대미술', '사진·미디어', '공예'],
    );
    expect(picked).toEqual([
      { kind: 'user', tag: '사진 찍기 좋음', users: 5 },
      { kind: 'user', tag: '조용함', users: 2 },
      { kind: 'topic', tag: '현대미술' },
      { kind: 'topic', tag: '사진·미디어' },
    ]);
  });

  it('사용자 태그가 4개 이상이면 주제 태그는 넣지 않는다', () => {
    const user = ['a', 'b', 'c', 'd', 'e'].map((tag, i) => ({ tag, users: 10 - i }));
    const picked = pickKeywords(user, ['현대미술']);
    expect(picked.map((k) => k.tag)).toEqual(['a', 'b', 'c', 'd']);
    expect(picked.every((k) => k.kind === 'user')).toBe(true);
  });

  it('users가 같으면 받은 순서를 지킨다', () => {
    const picked = pickKeywords(
      [
        { tag: 'x', users: 3 },
        { tag: 'y', users: 3 },
      ],
      [],
    );
    expect(picked.map((k) => k.tag)).toEqual(['x', 'y']);
  });

  it('서버 태그가 없으면 주제 태그만, 둘 다 없으면 빈 배열', () => {
    expect(pickKeywords(undefined, ['공예'])).toEqual([{ kind: 'topic', tag: '공예' }]);
    expect(pickKeywords([], [])).toEqual([]);
  });

  it('같은 글자는 한 번만 (사용자 태그가 먼저)', () => {
    expect(pickKeywords([{ tag: '공예', users: 2 }], ['공예', '현대미술'])).toEqual([
      { kind: 'user', tag: '공예', users: 2 },
      { kind: 'topic', tag: '현대미술' },
    ]);
  });

  it('max를 바꿀 수 있고 입력 배열을 바꾸지 않는다', () => {
    const user = [
      { tag: 'a', users: 2 },
      { tag: 'b', users: 9 },
    ];
    expect(pickKeywords(user, ['공예'], 1)).toEqual([{ kind: 'user', tag: 'b', users: 9 }]);
    expect(user[0].tag).toBe('a');
  });
});
