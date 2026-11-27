/**
 * 시설 파일(data/venues/*.json)에 적을 카카오맵 장소 ID(kakaoPlaceId) 후보를 찾는다.
 *
 * - 카카오 로컬 API(키워드 검색)로 시설 이름을 시설 좌표 반경 안에서 찾고,
 *   화면과 같은 규칙(src/lib/kakaoPlace.ts의 findPlace)으로 고른다.
 * - 기본은 출력만 한다. --write를 주면 kakaoPlaceId가 없는 시설 파일에만 고른 ID를 넣는다.
 *   이미 적힌 ID는 바꾸지 않고, 고른 것과 다르면 알린다. 넣은 뒤에는 장소 페이지를 열어 직접 확인한다.
 * - 키는 환경 변수 KAKAO_REST_API_KEY에서만 읽는다(.env를 읽지 않는다). 키는 출력하지 않는다.
 *   Kakao Developers → 내 애플리케이션 → 앱 키 → REST API 키 (지도용 JavaScript 키와 같은 앱)
 *
 * 실행:
 *   PowerShell:  $env:KAKAO_REST_API_KEY = "<REST API 키>"; npx tsx scripts/find-kakao-place-ids.ts [--write]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Venue } from '../src/types/index.ts';
import {
  PLACE_SEARCH_RADIUS,
  findPlace,
  kakaoPlaceUrl,
  type KakaoPlace,
  type LatLng,
} from '../src/lib/kakaoPlace.ts';
import { describePlace, insertKakaoPlaceId } from './kakao-place.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VENUE_DIR = path.join(ROOT, 'data', 'venues');

const API_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json';
const DELAY_MS = 200;
/** 못 찾았을 때 사람이 고를 수 있게 보여줄 검색 결과 수 */
const SHOWN = 3;

const write = process.argv.includes('--write');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let calls = 0;

async function searchKeyword(query: string, pos: LatLng, apiKey: string): Promise<KakaoPlace[]> {
  const url = new URL(API_URL);
  url.searchParams.set('query', query);
  url.searchParams.set('x', String(pos.lng));
  url.searchParams.set('y', String(pos.lat));
  url.searchParams.set('radius', String(PLACE_SEARCH_RADIUS));
  if (calls > 0) await sleep(DELAY_MS);
  calls++;
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${apiKey}` } });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} (검색어 "${query}"): ${body.slice(0, 200)}`);
  return (JSON.parse(body) as { documents?: KakaoPlace[] }).documents ?? [];
}

async function main() {
  const apiKey = process.env.KAKAO_REST_API_KEY?.trim();
  if (!apiKey) {
    console.error('❌ KAKAO_REST_API_KEY가 설정되지 않았습니다.');
    console.error('   PowerShell: $env:KAKAO_REST_API_KEY = "<REST API 키>"; npx tsx scripts/find-kakao-place-ids.ts');
    process.exit(1);
  }

  const files = fs.readdirSync(VENUE_DIR).filter((name) => name.endsWith('.json')).sort();
  console.log(`📍 시설 ${files.length}곳의 카카오맵 장소 ID 찾기 (반경 ${PLACE_SEARCH_RADIUS}m${write ? ', --write' : ''})\n`);

  const tally = { same: 0, added: 0, found: 0, differs: 0, missing: 0 };
  for (const file of files) {
    const full = path.join(VENUE_DIR, file);
    const text = fs.readFileSync(full, 'utf-8');
    const venue = JSON.parse(text) as Venue;
    const pos = { lat: venue.lat, lng: venue.lng };

    // 못 찾았을 때 보여주려고 받은 결과를 모아 둔다
    const seen = new Map<string, KakaoPlace>();
    const search = async (query: string, at: LatLng) => {
      const results = await searchKeyword(query, at, apiKey);
      for (const place of results) if (!seen.has(place.id)) seen.set(place.id, place);
      return results;
    };

    // 시설 이름으로 먼저, 못 찾으면 다른 이름으로
    let picked: KakaoPlace | null = null;
    for (const name of [venue.name, ...venue.aliases.filter((alias) => alias !== venue.name)]) {
      picked = await findPlace(name, pos, search);
      if (picked) break;
    }

    console.log(`${venue.id}  ${venue.name}`);
    if (!picked) {
      tally.missing++;
      console.log('   ❓ 이름이 맞는 장소를 못 찾았습니다. 직접 확인해 적어 주세요.');
      for (const place of [...seen.values()].slice(0, SHOWN)) console.log(`      - ${describePlace(place)}`);
    } else {
      console.log(`   ${describePlace(picked)}`);
      console.log(`   ${kakaoPlaceUrl(picked.id)}`);
      if (venue.kakaoPlaceId === picked.id) {
        tally.same++;
        console.log('   ✅ 파일에 적힌 ID와 같습니다');
      } else if (venue.kakaoPlaceId) {
        tally.differs++;
        console.log(`   ⚠️ 파일에는 ${venue.kakaoPlaceId}가 적혀 있습니다. 어느 쪽이 맞는지 확인해 주세요 (바꾸지 않음)`);
      } else if (write) {
        const next = insertKakaoPlaceId(text, picked.id);
        if (next.ok) {
          fs.writeFileSync(full, next.text);
          tally.added++;
          console.log('   ✏️ 파일에 넣었습니다');
        } else {
          tally.found++;
          console.log(
            next.reason === 'exists'
              ? '   ⚠️ 파일에 kakaoPlaceId 칸이 이미 있습니다(빈 값). 직접 적어 주세요'
              : '   ⚠️ 쉼표로 끝나는 "lng" 줄을 못 찾아 넣지 못했습니다. 직접 적어 주세요',
          );
        }
      } else {
        tally.found++;
        console.log('   ➕ 파일에 없습니다 (--write로 넣기)');
      }
    }
    console.log('');
  }

  console.log(
    `📊 같음 ${tally.same} / 넣음 ${tally.added} / 넣을 후보 ${tally.found} / 다름 ${tally.differs} / 못 찾음 ${tally.missing}`,
  );
  console.log(`📞 API 호출 ${calls}회`);
}

main().catch((error) => {
  console.error(`❌ ${String((error as Error).message ?? error)}`);
  console.error(`   API 호출 ${calls}회`);
  process.exit(1);
});
