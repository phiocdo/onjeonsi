/**
 * data/ 의 JSON 파일이 schema/ 의 형식에 맞는지 검사한다.
 *
 * 수집 워크플로(fetch.yml)가 매일 05:00에 사람 없이 돌아가므로,
 * 수집과 커밋 사이에서 이 스크립트가 실패하면 뒤 단계가 실행되지 않는다.
 * 즉 어긋난 데이터는 main 에 커밋되지 않고 배포도 되지 않는다.
 *
 * 로컬에서는 `npm run validate` 로 돌린다.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Ajv from 'ajv';
import type { ErrorObject } from 'ajv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/** 검사할 (스키마, 데이터) 짝. 데이터 파일이 늘어나면 여기에 한 줄 추가한다 */
const TARGETS = [
  { schema: 'schema/exhibitions.schema.json', data: 'data/exhibitions/auto.json' },
  { schema: 'schema/holidays.schema.json', data: 'data/holidays/holidays.json' }
];

/** 전시가 수천 건이면 오류도 수천 줄이 되므로 앞에서 끊는다 */
const MAX_SHOWN = 20;

function readJson(relativePath: string): unknown {
  const full = path.join(ROOT, relativePath);
  if (!fs.existsSync(full)) throw new Error(`파일이 없습니다: ${relativePath}`);
  try {
    return JSON.parse(fs.readFileSync(full, 'utf-8'));
  } catch {
    throw new Error(`JSON 형식이 깨졌습니다: ${relativePath}`);
  }
}

/**
 * 한 군데가 여러 줄로 불어나는 것을 한 줄로 합친다.
 *
 * ajv는 `anyOf`(예: number 또는 null)를 검사할 때 가지마다 오류를 하나씩 내고
 * 요약 오류를 또 하나 더 붙인다. 그래서 lat 하나가 틀리면 3건으로 세어진다.
 * 요약은 버리고, 같은 위치의 메시지는 모아서 한 줄로 만든다.
 */
function groupErrors(errors: ErrorObject[]): { path: string; messages: string[] }[] {
  const grouped = new Map<string, { path: string; messages: string[] }>();

  for (const error of errors) {
    if (error.keyword === 'anyOf') continue; // 가지별 오류가 더 구체적이라 요약은 버린다

    // 같은 항목에서 여러 필드가 빠진 경우를 뭉개지 않도록 빠진 필드명까지 키에 넣는다
    const missing = (error.params as { missingProperty?: string })?.missingProperty ?? '';
    const key = `${error.instancePath}|${missing}`;

    const entry = grouped.get(key) ?? { path: error.instancePath, messages: [] };
    if (error.message) entry.messages.push(error.message);
    grouped.set(key, entry);
  }

  return [...grouped.values()];
}

/**
 * 오류 위치를 사람이 찾을 수 있는 문구로 바꾼다.
 * instancePath 가 "/12/start" 꼴이라 앞의 숫자로 몇 번째 항목인지 알 수 있고,
 * 데이터가 배열이면 그 항목의 id·title 까지 같이 보여준다.
 */
function describe(error: { path: string; messages: string[] }, data: unknown): string {
  const where = error.path || '(파일 전체)';
  const what = `${where} ${error.messages.join(' / ')}`.trim();

  const index = Number(error.path.split('/')[1]);
  if (!Array.isArray(data) || !Number.isInteger(index)) return what;

  const item = data[index] as Record<string, unknown> | undefined;
  if (!item || typeof item !== 'object') return what;

  const id = typeof item.id === 'string' ? item.id : '';
  const title = typeof item.title === 'string' ? item.title : '';
  const label = [id, title].filter(Boolean).join(' / ');
  return label ? `${what}\n      ↳ ${label}` : what;
}

function validateAll(): boolean {
  // allErrors: 첫 오류에서 멈추지 않고 전부 모은다. 한 번 돌려서 다 고치는 게 낫다
  const ajv = new Ajv({ allErrors: true });
  let allPassed = true;

  for (const target of TARGETS) {
    let schema: unknown;
    let data: unknown;
    try {
      schema = readJson(target.schema);
      data = readJson(target.data);
    } catch (error) {
      console.error(`❌ ${target.data} — ${(error as Error).message}`);
      allPassed = false;
      continue;
    }

    const validate = ajv.compile(schema as object);
    const count = Array.isArray(data) ? `${data.length}건` : '1건';

    if (validate(data)) {
      console.log(`✅ ${target.data} (${count}) — ${path.basename(target.schema)} 통과`);
      continue;
    }

    allPassed = false;
    const errors = groupErrors(validate.errors ?? []);
    console.error(`❌ ${target.data} (${count}) — 어긋난 곳 ${errors.length}군데`);
    for (const error of errors.slice(0, MAX_SHOWN)) {
      console.error(`   · ${describe(error, data)}`);
    }
    if (errors.length > MAX_SHOWN) {
      console.error(`   ... 그 외 ${errors.length - MAX_SHOWN}군데 생략`);
    }
  }

  return allPassed;
}

console.log('🔍 데이터 형식 검사');

if (validateAll()) {
  console.log('✅ 모든 데이터가 스키마에 맞습니다.');
} else {
  console.error('\n❌ 스키마에 어긋난 데이터가 있어 검사를 통과하지 못했습니다.');
  // 종료 코드가 0이 아니면 워크플로의 뒤 단계(커밋)가 실행되지 않는다
  process.exit(1);
}
