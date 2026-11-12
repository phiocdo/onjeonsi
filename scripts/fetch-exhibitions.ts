import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseHours } from '../src/lib/parseHours.ts';

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
  ORG_LINK: string;
  LAT: string; // Latitude (위도)
  LOT: string; // Longitude (경도)
  PRO_TIME: string; // 운영시간 문구. 자유 서술이라 그대로는 못 쓴다
}

// 요일별 일정은 한 줄에 하나씩 붙여서 저장한다.
const DS_MARK = '__DS__';

/** DaySchedule 객체를 "한 줄로 쓸 것"이라고 표시해 둔다 */
function markOneLine(schedule: unknown): string {
  return DS_MARK + JSON.stringify(schedule) + DS_MARK;
}

/** 표시해 둔 일정만 한 줄로 되돌리고, 나머지는 보통 들여쓰기로 쓴다 */
function stringifyExhibitions(list: Record<string, unknown>[]): string {
  const prepared = list.map(ex => {
    const oh = ex.operatingHours as Record<string, unknown> | undefined;
    if (!oh) return ex;
    const weekdays = Object.fromEntries(
      Object.entries(oh.weekdays as Record<string, unknown>).map(([day, s]) => [day, markOneLine(s)])
    );
    const exceptions = (oh.exceptions as Array<{ date: string; schedule: unknown }>).map(e => ({
      date: e.date,
      schedule: markOneLine(e.schedule)
    }));
    return {
      ...ex,
      operatingHours: {
        ...oh,
        weekdays,
        holiday: oh.holiday ? markOneLine(oh.holiday) : null,
        exceptions
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
      return;
    }
    console.log(`📦 API 전체 행사 수: ${total}건 (${Math.ceil(total / PAGE_SIZE)}번 호출)`);

    const rows: RawSeoulEvent[] = [];
    for (let from = 1; from <= total; from += PAGE_SIZE) {
      rows.push(...await fetchPage(from, Math.min(from + PAGE_SIZE - 1, total)));
    }
    console.log(`📥 받아온 행사: ${rows.length}건`);

    // 종로구 / 중구 및 전시/미술 관련 행사 필터링
    const inTargetArea = rows.filter(item => {
      const gu = (item.GUNAME || '').trim();
      const code = (item.CODENAME || '').trim();
      const place = (item.PLACE || '').trim();

      const isTargetGu = gu.includes('종로구') || gu.includes('중구');
      const isTargetGenre =
        code.includes('전시') ||
        code.includes('미술') ||
        place.includes('미술관') ||
        place.includes('박물관') ||
        place.includes('갤러리') ||
        place.includes('DDP');

      return isTargetGu && isTargetGenre;
    });

    console.log(`🎯 종로구·중구 전시: ${inTargetArea.length}건`);

    // 이미 끝난 전시는 화면에 쓰지 않으므로 저장하지 않는다.
    // toISOString은 UTC 기준이라 오전 9시 전에 하루 어긋난다
    const today = new Date().toLocaleDateString('sv-SE');
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

    const exhibitions = filtered.map(({ item, start, end }, idx) => {
      const hoursText = (item.PRO_TIME || '').trim();
      // 특정 날짜 예외("11.17(화)")에 붙일 연도는 전시 시작 연도로 본다
      const year = start ? Number(start.slice(0, 4)) : new Date().getFullYear();
      const operatingHours = parseHours(hoursText, year);
      if (operatingHours.scheduleType === 'unknown') unknownHours++;

      return {
        id: `auto-seoul-${idx + 1}`,
        venueId: '',
        title: item.TITLE.trim(),
        start,
        end,
        field: item.CODENAME || '전시/미술',
        placeName: item.PLACE.trim(),
        hoursText,
        operatingHours,
        link: item.ORG_LINK || '',
        lat: Number(item.LAT),
        lng: Number(item.LOT),
        fetchedAt: new Date().toISOString()
      };
    });

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
  }
}

fetchExhibitions();
