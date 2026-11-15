import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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


const API_KEY = process.env.HOLIDAY_API_KEY; // 공공데이터포털 특일(공휴일) API 인증키
if (!API_KEY) {
  console.error('❌ HOLIDAY_API_KEY가 설정되지 않았습니다.');
  process.exit(1);
}


// 공공데이터포털 특일 API가 돌려주는 공휴일 항목 하나의 원본 모양
interface RawHoliday { 
    dateKind: string;
    dateName: string;
    isHoliday: string; // 'Y' 또는 'N'
    locdate: number; // 20260216 같은 숫자
    seq: number;
}


async function fetchYear(year: number): Promise<string[]> {
    console.log(`📡 ${year}년 공휴일 조회 중...`);

    // 한 번에 1월 ~ 12월까지 1년치 특일(공휴일) 조회
    const url = `http://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo?serviceKey=${API_KEY}&solYear=${year}&numOfRows=100&_type=json`

    try {
        const res = await fetch(url);
        const data = await res.json();

        // 요청이 정상 처리됐는지 확인 ("00"이 정상)
        if (data.response?.header?.resultCode !== '00') {
            throw new Error(`응답이 정상이 아닙니다: ${JSON.stringify(data).slice(0, 200)}`);
        }

        // 응답에서 공휴일 목록 꺼내기
        const raw: RawHoliday | RawHoliday[] = data.response?.body?.items?.item ?? [];
        const list: RawHoliday[] = Array.isArray(raw) ? raw : [raw];

        // 20260101 → '2026-01-01' 형태의 문자열 배열로 변환
        // holidays = ["2026-01-01", "2026-02-16", "2026-02-17", ...]
        const holidays: string[] = list 
        .filter((i) => i.isHoliday === 'Y')
        .map((i) => {
            const s = String(i.locdate);
            return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
        });


        // 공휴일이 하나도 없는 해는 없다. 0건이면 응답 형식이 바뀐 것으로 본다
        if (holidays.length === 0) {
            throw new Error(`공휴일이 0건입니다: ${JSON.stringify(data).slice(0, 200)}`);
        }

        return holidays;
    } catch (e) {
        // 빈 배열을 돌려주면 공휴일이 하나도 없는 holidays.json이 저장되고,
        // judge가 공휴일 휴관을 전부 놓쳐 설날에도 "가능"이 나온다.
        // 한 해만 실패해도 나머지 한 해만 저장되므로 실패는 실패로 올려 보낸다
        throw new Error(`${year}년 공휴일을 불러오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
    }

}


async function fetchHolidays() {
    console.log('📡 공공데이터포털 특일(공휴일) API 호출 중...');

    // 2년치 특일(공휴일) 조회
    const now = new Date();
    const now_year = now.getFullYear();

    try {
        const holidays = [
            ...(await fetchYear(now_year)),
            ...(await fetchYear(now_year + 1)),
        ];
        

        // data/holidays/holidays.json 에 저장
        const outputDir = path.resolve(__dirname, '../data/holidays');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const outputPath = path.join(outputDir, 'holidays.json');
        fs.writeFileSync(outputPath, JSON.stringify(holidays, null, 2), 'utf-8');
        console.log(`✅ ${outputPath} 저장 완료 (총 공휴일: ${holidays.length}일)`);

    } catch (e) {
        console.error('❌ fetch-holidays 스크립트 실행 중 에러 발생:', e);
        // 종료 코드가 0이면 워크플로가 실패를 알아채지 못하고 커밋 단계로 넘어간다
        process.exit(1);
    }
    
}

fetchHolidays();
