import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Ajv from 'ajv';
import { describe, it, expect } from 'vitest';
import type { Exhibition, Venue } from '../src/types/index.ts';
import { FEE_MAX } from './exhibition-fee.ts';
import {
  classify,
  decodeEntities,
  detailMismatches,
  hoursFromVenue,
  nonExhibitionWord,
  parseKcisaPrice,
  sameCandidateExhibition,
  titleContains,
  parseKcisaXml,
  toCandidate,
  toIsoDate,
  toManualDraft,
  type ClassifyContext,
} from './kcisa.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), 'utf-8');

const LIST_XML = read('scripts/fixtures/kcisa-realm2-sample.xml');
const DETAIL_XML = read('scripts/fixtures/kcisa-detail2-sample.xml');

const venues: Venue[] = fs
  .readdirSync(path.join(ROOT, 'data/venues'))
  .filter((name) => name.endsWith('.json'))
  .map((name) => JSON.parse(read(`data/venues/${name}`)) as Venue);
const venueById = (id: string) => venues.find((v) => v.id === id)!;

const TODAY = '2026-11-27';
const list = parseKcisaXml(LIST_XML);
const detail = parseKcisaXml(DETAIL_XML);
const itemOf = (seq: string) => list.items.find((item) => item.seq === seq)!;

function exhibition(partial: Partial<Exhibition> & Pick<Exhibition, 'id' | 'title' | 'start' | 'end'>): Exhibition {
  return { venueId: '', ...partial };
}

describe('parseKcisaXml — 목록', () => {
  it('header·totalCount·item을 읽는다', () => {
    expect(list.ok).toBe(true);
    expect(list.header).toEqual({ resultCode: '00', resultMsg: '정상입니다.' });
    expect(list.totalCount).toBe(7);
    expect(list.items).toHaveLength(7);
    expect(Object.keys(itemOf('246279'))).toEqual([
      'serviceName', 'seq', 'title', 'startDate', 'endDate', 'place', 'realmName', 'area', 'sigungu', 'thumbnail', 'gpsX', 'gpsY',
    ]);
  });

  it('두 번 이스케이프된 제목을 끝까지 푼다', () => {
    expect(itemOf('405272').title).toBe('김환, 남종현 <마주하는, 마주하지 않는 Facing, Without Facing>');
    expect(itemOf('366683').title).toBe('종로구립 박노수미술관 개관12주년 기념전시 「산수·격물」');
    expect(itemOf('409529').title).toBe('충북갤러리 서울관 김은식·손미선 2인전 <불 이후의 감각, 기억의 온도>');
  });

  it('CDATA·빈 태그·줄바꿈을 처리한다', () => {
    const xml = `<response><header><resultCode>00</resultCode><resultMsg>OK</resultMsg></header><body><items>
      <item><seq>1</seq><title><![CDATA[A & B <C>]]></title><contents1/><phone></phone>
      <place>
  첫 줄\r\n둘째 줄
      </place></item></items></body></response>`;
    const res = parseKcisaXml(xml);
    expect(res.ok).toBe(true);
    expect(res.totalCount).toBeUndefined();
    expect(res.items).toEqual([{ seq: '1', title: 'A & B <C>', contents1: '', phone: '', place: '첫 줄\n둘째 줄' }]);
  });
});

describe('parseKcisaXml — 상세·오류', () => {
  it('상세 item 1개를 읽는다', () => {
    expect(detail.ok).toBe(true);
    expect(detail.items).toHaveLength(1);
    const item = detail.items[0];
    expect(item.seq).toBe('366683');
    expect(item.price).toBe('어른 3,000원 / 청소년 1,800원 / 어린이 1,200원');
    expect(item.contents1).toBe('');
    expect(item.placeAddr).toBe('서울특별시 종로구 옥인1길 34 종로구립 박노수미술관');
  });

  it('resultCode가 00이 아니면 ok: false', () => {
    const res = parseKcisaXml(
      '<response><header><resultCode>22</resultCode><resultMsg>LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR</resultMsg></header></response>',
    );
    expect(res).toMatchObject({ ok: false, header: { resultCode: '22' }, items: [] });
  });

  it('공공데이터포털 공통 오류(cmmMsgHeader)면 ok: false와 메시지', () => {
    const res = parseKcisaXml(
      '<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>',
    );
    expect(res.ok).toBe(false);
    expect(res.header).toEqual({ resultCode: '30', resultMsg: 'SERVICE ERROR / SERVICE_KEY_IS_NOT_REGISTERED_ERROR' });
  });

  it('XML이 아니면 ok: false', () => {
    expect(parseKcisaXml('Unexpected errors').ok).toBe(false);
    expect(parseKcisaXml('').ok).toBe(false);
  });
});

describe('decodeEntities', () => {
  it('바뀌지 않을 때까지(최대 3번) 푼다', () => {
    expect(decodeEntities('&amp;#39;한강&amp;#39;')).toBe("'한강'");
    expect(decodeEntities('&amp;amp;lt;')).toBe('<');
    // 4겹이면 3번만 풀어 한 겹이 남는다
    expect(decodeEntities('&amp;amp;amp;lt;')).toBe('&lt;');
  });

  it('숫자 엔티티와 모르는 엔티티', () => {
    expect(decodeEntities('&#xB098;&#45208;')).toBe('나나');
    expect(decodeEntities('&unknown; & 그대로')).toBe('&unknown; & 그대로');
  });
});

describe('parseKcisaPrice', () => {
  it("정확히 '무료'면 isFree: true", () => {
    expect(parseKcisaPrice(' 무료 ')).toEqual({ isFree: true, fee: '무료' });
  });

  it('금액이 있고 무료라는 말이 없으면 isFree: false + 원문', () => {
    expect(parseKcisaPrice('어른 3,000원 / 청소년 1,800원 / 어린이 1,200원')).toEqual({
      isFree: false,
      fee: '어른 3,000원 / 청소년 1,800원 / 어린이 1,200원',
    });
  });

  it('섞인 문구는 isFree 없이 fee만', () => {
    expect(parseKcisaPrice('무료(일부 유료)')).toEqual({ fee: '무료(일부 유료)' });
    expect(parseKcisaPrice('성인 5,000원 (65세 이상 무료)')).toEqual({ fee: '성인 5,000원 (65세 이상 무료)' });
    expect(parseKcisaPrice('현장 문의')).toEqual({ fee: '현장 문의' });
  });

  it('빈 값이면 둘 다 없음', () => {
    expect(parseKcisaPrice('')).toEqual({});
    expect(parseKcisaPrice('   ')).toEqual({});
    expect(parseKcisaPrice(undefined)).toEqual({});
  });

  it('아주 긴 문구는 FEE_MAX자로 자른다', () => {
    const long = '성인 1,000원 '.repeat(200);
    const { isFree, fee } = parseKcisaPrice(long);
    expect(isFree).toBe(false);
    expect(Array.from(fee!).length).toBe(FEE_MAX);
    expect(fee!.endsWith('…')).toBe(true);
  });
});

describe('toCandidate', () => {
  it('목록만으로 바꾼다', () => {
    const c = toCandidate(itemOf('405272'));
    expect(c).toEqual({
      seq: '405272',
      title: '김환, 남종현 <마주하는, 마주하지 않는 Facing, Without Facing>',
      start: '2026-11-06',
      end: '2026-11-29',
      placeName: '16아카이브',
      sigungu: '중구',
      realm: '전시',
      serviceName: '공연',
      lat: 37.5633707166453,
      lng: 126.998842453489,
      imageUrl: 'http://www.culture.go.kr/upload/ucms/oneCltInfo/2026/202610/62d05ef03aa7443d9a9caf443c262486.png',
      hasDetail: false,
    });
  });

  it('제목 끝 공백을 지운다', () => {
    expect(toCandidate(itemOf('409529')).title).toBe('충북갤러리 서울관 김은식·손미선 2인전 <불 이후의 감각, 기억의 온도>');
  });

  it('상세로 링크·요금·주소를 보충하고 이미지는 상세 imgUrl을 먼저 쓴다', () => {
    const c = toCandidate(itemOf('366683'), { ...detail.items[0], imgUrl: 'https://example.com/detail.jpg' });
    expect(c).toMatchObject({
      link: 'https://www.jfac.or.kr/site/main/program/perf_exhi_list_view?pgIdx=2519',
      placeUrl: 'https://www.jfac.or.kr/site/main/content/parkns01',
      address: '서울특별시 종로구 옥인1길 34 종로구립 박노수미술관',
      imageUrl: 'https://example.com/detail.jpg',
      isFree: false,
      fee: '어른 3,000원 / 청소년 1,800원 / 어린이 1,200원',
      hasDetail: true,
    });
  });

  it('좌표가 서울 범위 밖이거나 비면 둘 다 null', () => {
    expect(toCandidate({ ...itemOf('366683'), gpsY: '' })).toMatchObject({ lat: null, lng: null });
    expect(toCandidate({ ...itemOf('366683'), gpsX: '37.58', gpsY: '126.96' })).toMatchObject({ lat: null, lng: null });
  });

  it('toIsoDate는 달력에 없는 날짜를 거른다', () => {
    expect(toIsoDate('20261206')).toBe('2026-12-06');
    expect(toIsoDate('20260230')).toBe('');
    expect(toIsoDate('2026-12-06')).toBe('');
  });
});

describe('detailMismatches', () => {
  it('목록과 같으면 경고 없음', () => {
    expect(detailMismatches(itemOf('366683'), detail.items[0])).toEqual([]);
  });

  it('sigungu·placeAddr가 다르면 경고', () => {
    const warnings = detailMismatches(itemOf('366683'), {
      ...detail.items[0],
      sigungu: '중구',
      placeAddr: '서울특별시 중구 세종대로 61',
    });
    expect(warnings).toHaveLength(2);
  });
});

describe('classify', () => {
  const candidates = list.items.map((item) => toCandidate(item));
  const ctx: ClassifyContext = {
    // 서울시 API로 들어온 SeMA 전시 (제목 표기가 조금 달라도 정규화하면 같다)
    auto: [
      exhibition({
        id: 'auto-seoul-1',
        title: '린 허쉬만 리슨: 나의 [나]들',
        start: '2026-10-21',
        end: '2027-02-21',
        placeName: '서울시립미술관 서소문본관',
        lat: 37.5641,
        lng: 126.9737,
      }),
    ],
    // 사람이 넣은 MMCA 전시 (id 관례가 같다)
    manual: [
      exhibition({
        id: 'manual-kcisa-364451',
        title: '올해의 작가상 2026',
        start: '2026-07-24',
        end: '2026-12-06',
        placeName: '국립현대미술관 서울관',
      }),
    ],
    venues,
    links: {},
    today: TODAY,
  };
  const results = classify(candidates, ctx);
  const resultOf = (seq: string) => results.find((r) => r.candidate.seq === seq)!;

  it('추가 후보: 종로구·전시·진행 중·시설 연결·중복 없음', () => {
    expect(resultOf('366683')).toMatchObject({
      category: 'add',
      venueId: 'venue-park-no-soo-museum',
      matchedBy: 'alias',
    });
    expect(results.filter((r) => r.category === 'add').map((r) => r.candidate.seq)).toEqual(['366683']);
  });

  it('auto.json에 같은 전시가 있으면 이미 있음', () => {
    expect(resultOf('402891')).toMatchObject({
      category: 'existing',
      venueId: 'venue-sema',
      sameAs: { source: 'auto', id: 'auto-seoul-1' },
    });
  });

  it('manual.json에 같은 전시가 있으면 이미 있음', () => {
    expect(resultOf('364451')).toMatchObject({
      category: 'existing',
      sameAs: { source: 'manual', id: 'manual-kcisa-364451' },
    });
  });

  it('manual.json에 같은 id가 있으면 제목이 바뀌어도 이미 있음', () => {
    const [r] = classify([{ ...toCandidate(itemOf('364451')), title: '올해의 작가상 2026 (연장)' }], ctx);
    expect(r).toMatchObject({ category: 'existing', sameAs: { source: 'manual', id: 'manual-kcisa-364451' } });
  });

  it('auto와 manual에 모두 있으면 auto를 먼저 적는다', () => {
    const [r] = classify([toCandidate(itemOf('364451'))], {
      ...ctx,
      auto: [exhibition({ id: 'auto-seoul-9', title: '올해의 작가상 2026', start: '2026-07-24', end: '2026-12-06', placeName: '국립현대미술관' })],
    });
    expect(r.sameAs).toEqual({ source: 'auto', id: 'auto-seoul-9', title: '올해의 작가상 2026', by: 'exact' });
  });

  it('시설 미연결 (serviceName이 공연이어도 realmName이 전시면 전시로 본다)', () => {
    expect(resultOf('405272')).toMatchObject({ category: 'unlinked', reason: '시설 미연결' });
    expect(resultOf('409529')).toMatchObject({ category: 'unlinked' });
  });

  it('끝난 전시', () => {
    expect(resultOf('246279')).toMatchObject({ category: 'excluded', reason: '끝남(2025-12-31)' });
  });

  it('구 밖', () => {
    expect(resultOf('394076')).toMatchObject({ category: 'excluded', reason: '구 밖(성북구)' });
  });

  it('전시 아님', () => {
    const [r] = classify([{ ...toCandidate(itemOf('366683')), realm: '공연' }], ctx);
    expect(r).toMatchObject({ category: 'excluded', reason: "전시 아님(realmName '공연')" });
  });

  it('오늘 끝나는 전시는 아직 후보', () => {
    const [r] = classify([toCandidate(itemOf('366683'))], { ...ctx, today: '2026-12-06' });
    expect(r.category).toBe('add');
  });
});

describe('classify — 제목 포함 일치 (후보 전용)', () => {
  // 목록 item 최소 모양
  const listItem = (seq: string, title: string, start: string, end: string, place: string, lat: string, lng: string) => ({
    serviceName: '전시', seq, title, startDate: start, endDate: end, place, realmName: '전시', sigungu: '종로구', gpsX: lng, gpsY: lat,
  });
  const CRAFT = { lat: '37.5766481740232', lng: '126.983533363501' };
  const ARCHIVE = { lat: '37.6078008399411', lng: '126.97190179486' };
  const equinox = toCandidate(listItem('399680', '에퀴녹스: 추분_춘분', '20260922', '20270307', '서울공예박물관', CRAFT.lat, CRAFT.lng));
  const ohyun = toCandidate(listItem('395490', '《오윤》', '20260827', '20270214', '서울시립 미술아카이브', ARCHIVE.lat, ARCHIVE.lng));

  const autoEquinox = exhibition({
    id: 'auto-seoul-159218',
    title: '[서울공예박물관] 현대공예 기증특별전 [에퀴녹스 : 추분_춘분]',
    start: '2026-09-22',
    end: '2027-03-07',
    placeName: '서울공예박물관 전시1동 3층 기획전시실',
    lat: 37.5766481740232,
    lng: 126.983533363501,
  });
  const autoOhyun = exhibition({
    id: 'auto-seoul-159460',
    title: '[서울시립 미술아카이브] 소장자료 기획전 [오윤]',
    start: '2026-08-27',
    end: '2027-02-14',
    placeName: '서울시립 미술아카이브 모음동 1,2층',
    lat: 37.6078008399411,
    lng: 126.97190179486,
  });
  const ctx: ClassifyContext = { auto: [autoEquinox, autoOhyun], manual: [], venues, links: {}, today: TODAY };

  it('에퀴녹스: 서울시 제목의 [대괄호] 안에 들어 있으면 이미 있음', () => {
    const [r] = classify([equinox], ctx);
    expect(r).toMatchObject({
      category: 'existing',
      venueId: 'venue-craft-museum',
      reason: 'auto.json의 auto-seoul-159218와 같은 전시(제목 포함 일치)',
      sameAs: { source: 'auto', id: 'auto-seoul-159218', by: 'title-contains' },
    });
  });

  it('오윤: 후보 제목 전체가 서울시 제목의 [대괄호] 하나와 같으면 2글자여도 이미 있음', () => {
    const [r] = classify([ohyun], ctx);
    expect(r).toMatchObject({
      category: 'existing',
      venueId: 'venue-sema-archive',
      sameAs: { source: 'auto', id: 'auto-seoul-159460', by: 'title-contains' },
    });
  });

  it('manual.json에도 제목 포함 일치를 쓴다', () => {
    const [r] = classify([equinox], { ...ctx, auto: [], manual: [{ ...autoEquinox, id: 'manual-x' }] });
    expect(r.sameAs).toMatchObject({ source: 'manual', id: 'manual-x', by: 'title-contains' });
  });

  it('같은 시설이라도 공통 제목이 3글자뿐이면 같은 전시가 아니다', () => {
    const short = toCandidate(listItem('1', '나무숲', '20260922', '20270307', '서울공예박물관', CRAFT.lat, CRAFT.lng));
    const auto = exhibition({ ...autoEquinox, id: 'auto-3', title: '현대공예 나무숲 이야기' });
    expect(titleContains('나무숲', '현대공예 나무숲 이야기')).toBe(false);
    expect(classify([short], { ...ctx, auto: [auto] })[0].category).toBe('add');
  });

  it('제목이 포함돼도 시설이 다르면 같은 전시가 아니다', () => {
    const elsewhere = { ...autoEquinox, placeName: '서울역사박물관', lat: 37.570507525011855, lng: 126.97052372473162 };
    expect(classify([equinox], { ...ctx, auto: [elsewhere] })[0].category).toBe('add');
  });

  it('제목이 포함돼도 한쪽이 시설에 연결되지 않으면 같은 전시가 아니다', () => {
    const unlinked = { ...autoEquinox, placeName: '어딘가 갤러리', lat: 37.59, lng: 127.0 };
    expect(classify([equinox], { ...ctx, auto: [unlinked] })[0].category).toBe('add');
  });

  it('제목이 포함돼도 기간이 안 겹치면 같은 전시가 아니다', () => {
    const earlier = { ...autoEquinox, start: '2025-01-01', end: '2025-06-30' };
    expect(classify([equinox], { ...ctx, auto: [earlier] })[0].category).toBe('add');
  });

  it('sameCandidateExhibition: 정확히 같으면 exact', () => {
    const venueIdOf = (e: Exhibition) => (e.placeName?.includes('공예') ? 'venue-craft-museum' : null);
    const a = exhibition({ id: 'a', title: '에퀴녹스', start: '2026-01-01', end: '2026-02-01', placeName: '서울공예박물관' });
    expect(sameCandidateExhibition(a, { ...a, id: 'b' }, venueIdOf)).toBe('exact');
    expect(sameCandidateExhibition(a, { ...a, id: 'b', title: '기증특별전 에퀴녹스' }, venueIdOf)).toBe('title-contains');
  });
});

describe('classify — 상영·공연 프로그램 제외 (#81)', () => {
  const MMCA = { lat: '37.5786274905286', lng: '126.98010361777375' };
  const mmca = (seq: string, title: string) =>
    toCandidate({
      serviceName: '전시', seq, title, startDate: '20260401', endDate: '20261220', place: '국립현대미술관 서울관',
      realmName: '전시', sigungu: '종로구', gpsX: MMCA.lng, gpsY: MMCA.lat,
    });
  const ctx: ClassifyContext = { auto: [], manual: [], venues, links: {}, today: TODAY };

  it('MMCA 필름앤비디오·다원예술은 전시 아님', () => {
    const results = classify([mmca('364987', 'MMCA 필름앤비디오 2026'), mmca('364986', 'MMCA 다원예술 2026: 탐정의 시간')], ctx);
    expect(results.map((r) => [r.category, r.reason])).toEqual([
      ['excluded', "전시 아님(상영·공연 프로그램: '필름앤비디오')"],
      ['excluded', "전시 아님(상영·공연 프로그램: '다원예술')"],
    ]);
  });

  it('대소문자·공백을 무시하고 찾는다', () => {
    expect(nonExhibitionWord('MMCA 필름 앤 비디오')).toBe('필름앤비디오');
    expect(nonExhibitionWord('특별 상 영회')).toBe('상영');
    expect(nonExhibitionWord('에퀴녹스: 추분_춘분')).toBeUndefined();
  });

  it("'공연'이 들어간 제목은 제외하지 않는다 (공연장으로 간 미술)", () => {
    expect(nonExhibitionWord('공연장으로 간 미술')).toBeUndefined();
    expect(classify([mmca('333675', '공연장으로 간 미술')], ctx)[0].category).toBe('add');
  });

  it('같은 시설의 보통 전시는 그대로 추가 후보', () => {
    expect(classify([mmca('1', '올해의 작가상 2099')], ctx)[0].category).toBe('add');
  });
});

describe('toManualDraft', () => {
  const schema = JSON.parse(read('schema/exhibitions.schema.json')) as {
    items: { properties: Record<string, unknown> };
  };
  const validate = new Ajv({ allErrors: true }).compile(schema);
  const candidate = toCandidate(itemOf('366683'), detail.items[0]);
  const venue = venueById('venue-park-no-soo-museum');

  it('manual.json 관례대로 초안을 만든다', () => {
    const draft = toManualDraft(candidate, venue);
    expect(draft).toMatchObject({
      id: 'manual-kcisa-366683',
      venueId: '',
      title: '종로구립 박노수미술관 개관12주년 기념전시 「산수·격물」',
      start: '2025-09-19',
      end: '2026-12-06',
      placeName: '종로구립 박노수미술관',
      hoursText: '',
      link: 'https://www.jfac.or.kr/site/main/content/parkns01',
      detailUrl: 'https://www.jfac.or.kr/site/main/program/perf_exhi_list_view?pgIdx=2519',
      lat: 37.5813162146987,
      lng: 126.96678911202187,
      isFree: false,
      fee: '어른 3,000원 / 청소년 1,800원 / 어린이 1,200원',
    });
    expect(draft.operatingHours?.weekdays.mon).toEqual({ isOpen: false, intervals: [] });
    expect(draft.operatingHours?.weekdays.tue).toEqual({ isOpen: true, intervals: [{ open: '10:00', close: '18:00' }] });
    expect('fetchedAt' in draft).toBe(false);
  });

  it('스키마를 통과하고 스키마에 없는 키가 없다(validate-data와 같은 검사)', () => {
    const known = new Set(Object.keys(schema.items.properties));
    const drafts = [
      toManualDraft(candidate, venue, '2026-11-27T01:02:03Z'),
      // 상세 없이, 좌표 없이 만든 초안
      toManualDraft({ ...toCandidate(itemOf('366683')), lat: null, lng: null }, venue),
    ];
    expect(validate(drafts), JSON.stringify(validate.errors)).toBe(true);
    for (const draft of drafts) expect(Object.keys(draft).filter((key) => !known.has(key))).toEqual([]);
  });

  it('hours가 없는 시설이면 scheduleType unknown', () => {
    const hours = hoursFromVenue({ ...venue, hours: undefined });
    expect(hours.scheduleType).toBe('unknown');
    expect(Object.values(hours.weekdays).every((d) => !d.isOpen)).toBe(true);
  });
});
