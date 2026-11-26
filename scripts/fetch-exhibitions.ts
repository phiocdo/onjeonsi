import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseHours } from '../src/lib/parseHours.ts';
import { makeExhibitionId, findDuplicateIds } from './exhibition-id.ts';
import { isTargetEvent } from './exhibition-filter.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 로컬 .env 파일 환경 변수 로드
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf-8');
  envConfig.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) process.env[key.trim()] = value.trim();
  });
}

const API_KEY = process.env.SEOUL_DATA_API_KEY;
if (!API_KEY) {
  console.error('❌ SEOUL_DATA_API_KEY가 설정되지 않았습니다.');
  process.exit(1);
}

interface RawSeoulEvent {
  CODENAME: string;
  TITLE: string;
  DATE: string;
  PLACE: string;
  GUNAME: string;
  STRTDATE: string;
  END_DATE: string;
  ORG_LINK: string; // 기관 홈페이지
  MAIN_IMG: string; // 대표 이미지
  HMPG_ADDR: string; // 서울문화포털 상세 페이지
  LAT: string; // Latitude (위도)
  LOT: string; // Longitude (경도)
  PRO_TIME: string; // 운영시간 문구. 자유 서술이라 그대로는 못 쓴다
}

/**
 * 좌표 문자열을 숫자로 바꾼다. 쓸 수 없는 값이면 null을 돌려준다.
 *
 * `Number()`를 그대로 쓰면 안 된다. 빈 문자열과 공백은 0이 되는데,
 * 실제로 LAT이 빈 문자열인 전시가 19건 있어서 아프리카 서쪽 바다(0, 0)에
 * 핀이 찍힌다. 숫자가 아닌 값은 NaN이 되고, JSON으로 쓰면 null이 된다.
 */
function toCoord(value: string): number | null {
  const text = (value ?? '').trim();
  if (text === '') return null;

  const num = Number(text);
  if (!Number.isFinite(num) || num === 0) return null;

  return num;
}

// 서울 범위. schema/exhibitions.schema.json, venue.schema.json 과 같은 값이다
const SEOUL_LAT = [37.4, 37.7];
const SEOUL_LNG = [126.7, 127.3];

/**
 * 위도·경도를 한 쌍으로 읽는다. 하나라도 없거나 서울 범위 밖이면 둘 다 null.
 *
 * 범위 밖 좌표(위도·경도가 뒤바뀐 값 등)를 그대로 두면 지도에 엉뚱한 핀이 찍히고,
 * 스키마 검사에 걸려 그날 배포가 멈춘다. 좌표가 없는 전시와 똑같이 "위치 미상"으로 둔다.
 */
function toLatLng(latText: string, lngText: string): { lat: number | null; lng: number | null } {
  const lat = toCoord(latText);
  const lng = toCoord(lngText);
  const inRange = (v: number | null, [lo, hi]: number[]) => v !== null && v >= lo && v <= hi;
  return inRange(lat, SEOUL_LAT) && inRange(lng, SEOUL_LNG) ? { lat, lng } : { lat: null, lng: null };
}

// 요일별 일정은 한 줄에 하나씩 붙여서 저장한다.
const DS_MARK = '__DS__';

/** DaySchedule 객체를 "한 줄로 쓸 것"이라고 표시해 둔다 */
function markOneLine(schedule: unknown): string {
  return DS_MARK + JSON.stringify(schedule) + DS_MARK;
}

/** 요일 7개를 각각 한 줄로 표시해 둔다 */
function markWeekdays(weekdays: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(weekdays).map(([day, s]) => [day, markOneLine(s)]));
}

/** 표시해 둔 일정만 한 줄로 되돌리고, 나머지는 보통 들여쓰기로 쓴다 */
function stringifyExhibitions(list: Record<string, unknown>[]): string {
  const prepared = list.map(ex => {
    const oh = ex.operatingHours as Record<string, unknown> | undefined;
    if (!oh) return ex;
    const exceptions = (oh.exceptions as Array<{ date: string; schedule: unknown }>).map(e => ({
      date: e.date,
      schedule: markOneLine(e.schedule)
    }));
    // periods 안의 요일도 같은 방식으로 한 줄씩 쓴다
    const periods = (oh.periods as Array<Record<string, unknown>> | undefined)?.map(p => ({
      ...p,
      weekdays: markWeekdays(p.weekdays as Record<string, unknown>)
    }));
    return {
      ...ex,
      operatingHours: {
        ...oh,
        weekdays: markWeekdays(oh.weekdays as Record<string, unknown>),
        holiday: oh.holiday ? markOneLine(oh.holiday) : null,
        exceptions,
        ...(periods ? { periods } : {})
      }
    };
  });

  return JSON.stringify(prepared, null, 2).replace(
    new RegExp(`"${DS_MARK}.*?${DS_MARK}"`, 'g'),
    token => (JSON.parse(token) as string).slice(DS_MARK.length, -DS_MARK.length)
  );
}

const BASE_URL = `http://openapi.seoul.go.kr:8088/${API_KEY}/json/culturalEventInfo`;
// API는 한 번에 최대 1,000건만 돌려준다. 전체는 2만 건에 가까워 페이지를 넘겨 받아야 한다
const PAGE_SIZE = 1000;


// 서버 필터(CODENAME, DATE)를 사용하면 누락되는 데이터가 존재하므로 전수 조회한다
async function fetchPage(from: number, to: number): Promise<RawSeoulEvent[]> {
  const res = await fetch(`${BASE_URL}/${from}/${to}/`);
  const data = await res.json();
  if (!data.culturalEventInfo?.row) {
    throw new Error(`데이터를 불러오지 못했습니다: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data.culturalEventInfo.row;
}

async function fetchExhibitions() {
  console.log('📡 서울시 문화행사 API 호출 중...');

  try {
    const head = await fetch(`${BASE_URL}/1/1/`).then(r => r.json());
    const total: number = head.culturalEventInfo?.list_total_count ?? 0;
    if (!total) {
      console.error('❌ 전체 건수를 읽지 못했습니다:', JSON.stringify(head).slice(0, 200));
      // 종료 코드가 0이면 워크플로가 실패를 알아채지 못하고 예전 데이터를 새 데이터로 여긴다.
      // process.exit()은 비동기 작업이 정리되는 중에 부르면 libuv 어서션으로 죽는다
      process.exitCode = 1;
      return;
    }
    console.log(`📦 API 전체 행사 수: ${total}건 (${Math.ceil(total / PAGE_SIZE)}번 호출)`);

    const rows: RawSeoulEvent[] = [];
    for (let from = 1; from <= total; from += PAGE_SIZE) {
      rows.push(...await fetchPage(from, Math.min(from + PAGE_SIZE - 1, total)));
    }
    console.log(`📥 받아온 행사: ${rows.length}건`);

    // 종로구·중구의 전시 분류만 고른다. 장소(미술관·박물관 등)는 보지 않는다(근거는 exhibition-filter.ts)
    const inTargetArea = rows.filter(isTargetEvent);

    console.log(`🎯 종로구·중구 전시: ${inTargetArea.length}건`);

    // 이미 끝난 전시는 화면에 쓰지 않으므로 저장하지 않는다.
    //
    // 시간대를 적지 않으면 돌아가는 기계의 시간대를 따른다. 내 PC는 KST라 맞지만
    // GitHub Actions는 UTC다. 수집은 20:00 UTC(= 05:00 KST 다음 날)에 도는데
    // 그 시점의 UTC 날짜는 한국 날짜보다 하루 전이라, 어제 끝난 전시가 하루 더 남는다.
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
    let swapped = 0;

    const dated = inTargetArea.map(item => {
      let start = item.STRTDATE ? item.STRTDATE.split(' ')[0] : '';
      let end = item.END_DATE ? item.END_DATE.split(' ')[0] : '';
      // 원본에 시작일과 종료일이 뒤집혀 들어오는 경우가 있다
      if (start && end && start > end) {
        [start, end] = [end, start];
        swapped++;
      }
      return { item, start, end };
    });

    const filtered = dated.filter(({ end }) => !end || end >= today);
    console.log(`📅 오늘(${today}) 이후까지 열리는 전시: ${filtered.length}건 ` +
      `(지난 전시 ${dated.length - filtered.length}건 제외)`);

    // index.ts Exhibition 규격에 맞게 변환
    let unknownHours = 0;

    const exhibitions = filtered.map(({ item, start, end }) => {
      const hoursText = (item.PRO_TIME || '').trim();
      // 연도 없이 적힌 날짜("11.17(화)")는 전시 시작 연도~종료 연도 중 괄호 안 요일이 맞는 해로 본다
      const year = start ? Number(start.slice(0, 4)) : new Date().getFullYear();
      const endYear = end ? Number(end.slice(0, 4)) : undefined;
      const operatingHours = parseHours(hoursText, year, endYear);
      if (operatingHours.scheduleType === 'unknown') unknownHours++;

      const title = (item.TITLE || '').trim();
      const placeName = (item.PLACE || '').trim();
      const detailUrl = item.HMPG_ADDR || '';

      return {
        // 목록 순서가 아니라 전시 자체에서 끌어낸다. 수집마다 같은 id가 나와야 한다.
        // 서울시가 매긴 cultcode를 먼저 쓰고, 없으면 내용을 해시한다
        id: makeExhibitionId({ title, placeName, start, detailUrl }),
        venueId: '',
        title,
        start,
        end,
        // 필터가 전시 분류만 남기므로 값은 늘 있다. 필터처럼 앞뒤 공백을 떼고 저장한다
        field: (item.CODENAME ?? '').trim(),
        placeName,
        hoursText,
        operatingHours,
        // 앞뒤 공백이 붙어 오는 링크가 있다(" https://..."). 주소 안의 공백은 API 원문이라 둔다
        link: (item.ORG_LINK || '').trim(),
        imageUrl: item.MAIN_IMG || '',
        detailUrl,
        ...toLatLng(item.LAT, item.LOT),
        fetchedAt: new Date().toISOString()
      };
    });

    // 제목·장소·시작일이 모두 같은 전시가 두 건 올라오면 id도 같아진다.
    // 스키마로는 id 중복을 잡을 수 없으므로 여기서 멈춘다
    const duplicated = findDuplicateIds(exhibitions);
    if (duplicated.length) {
      console.error(`❌ id가 겹치는 전시가 있습니다 (${duplicated.length}건). 저장하지 않습니다.`);
      for (const id of duplicated) {
        console.error(`   ${id}`);
        for (const ex of exhibitions.filter(e => e.id === id)) {
          console.error(`     ${ex.start}~${ex.end}  ${ex.placeName}  ${ex.title}`);
        }
      }
      process.exitCode = 1;
      return;
    }

    const outputDir = path.resolve(__dirname, '../data/exhibitions');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, 'auto.json');
    fs.writeFileSync(outputPath, stringifyExhibitions(exhibitions), 'utf-8');
    console.log(`✅ ${outputPath} 저장 완료 (${exhibitions.length}건)`);
    if (swapped) console.log(`   시작일·종료일이 뒤집혀 있어 바로잡은 전시: ${swapped}건`);
    console.log(`   운영시간 파싱: ${exhibitions.length - unknownHours}건 / 판별 불가 ${unknownHours}건`);
  } catch (error) {
    console.error('❌ 스크립트 실행 중 에러 발생:', error);
    // 에러를 로그만 찍고 0으로 끝내면, 수집이 조용히 건너뛰어진 채
    // 예전 파일이 검사를 통과해 수집이 성공한 것처럼 보인다
    process.exitCode = 1;
  }
}

fetchExhibitions();
