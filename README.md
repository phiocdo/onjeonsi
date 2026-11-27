# 온전시

서울 종로구·중구에서 열리는 전시를 모아, **지금 갈 수 있는지** 알려주는 웹입니다.

- 배포: <https://phiocdo.github.io/onjeonsi/>
- 동국대학교 공개SW프로젝트 (2026학년도 2학기)

## 화면

| 화면 | 하는 일 |
| --- | --- |
| 내 동네 전시 | 기준 위치 주변 전시를 지도와 목록으로 |
| 한눈에 보기 | 전시 전체를 한 화면에 |
| 언제 갈까 | 시간대별로 갈 수 있는 전시 |


## 기술 스택

Vite · React · TypeScript

데이터 수집 스크립트는 `tsx`로 실행하고, 결과를 JSON 파일로 저장합니다.
저장소의 `data/`는 사람이 PR로 갱신합니다 (아래 [자동 수집과 배포](#자동-수집과-배포) 참고).

외부 API는 서울 열린데이터광장(전시), 공공데이터포털(공휴일), 카카오맵(지도)을 씁니다.
카카오맵 SDK는 `package.json`이 아니라 `index.html`에서 `<script>`로 불러옵니다.

## 실행 방법

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경 변수 설정

`.env.example`을 복사해 `.env`를 만들고 키를 채웁니다.

```bash
cp .env.example .env
```

| 변수 | 쓰는 곳 | 발급 |
| --- | --- | --- |
| `SEOUL_DATA_API_KEY` | 전시 수집 스크립트 | [서울 열린데이터광장](https://data.seoul.go.kr) → 문화행사 정보 |
| `HOLIDAY_API_KEY` | 공휴일 수집 스크립트 | [공공데이터포털](https://www.data.go.kr) → 특일 정보 |
| `KCISA_API_KEY` | `manual.json` 보충 후보 찾기 (선택, 환경 변수로만) | [공공데이터포털](https://www.data.go.kr) → 한국문화정보원 한눈에보는문화정보 |
| `VITE_KAKAO_MAP_KEY` | 지도 표시 (브라우저) | [Kakao Developers](https://developers.kakao.com) → JavaScript 키 |

`.env`는 `.gitignore`에 들어 있습니다. 저장소가 공개되어 있으니 키를 커밋하면 안됩니다.

> 카카오맵 키는 플랫폼 도메인을 등록해야 동작합니다.
> Kakao Developers → 내 애플리케이션 → 앱 설정 → 플랫폼 → Web에
> `http://localhost:5173`을 추가하세요. 배포 주소는 이미 등록되어 있습니다.

### 3. 개발 서버 실행

```bash
npm run dev
```

## 명령어

| 명령어 | 하는 일 |
| --- | --- |
| `npm run dev` | 개발 서버 (`http://localhost:5173`) |
| `npm run build` | 타입 검사 후 `dist/`에 빌드 |
| `npm run preview` | 빌드 결과를 로컬에서 확인 |
| `npm run lint` | ESLint 검사 |
| `npm run validate` | `data/`의 JSON이 `schema/` 형식에 맞는지 검사 |

## 데이터

| 파일 | 내용 | 만드는 방법 |
| --- | --- | --- |
| `data/exhibitions/auto.json` | 종로·중구 전시 | 서울시 API 자동 수집 |
| `data/exhibitions/manual.json` | 서울시 API에 없는 전시 (지금은 국립현대미술관 서울관) | 사람이 직접 추가 |
| `data/holidays/holidays.json` | 공휴일 | 공공데이터포털 자동 수집 |
| `data/venues/` | 시설 운영 정보 | 사람이 직접 조사 (작성 중) |

운영시간·휴관일은 API로 제공되지 않아 손으로 조사합니다. 그래서 시설 데이터는
수동이고, 각 항목에 출처(`source`)와 확인 날짜(`verified`)를 남깁니다.

### 사람이 채우는 전시 (`manual.json`)

서울시 API에 없는 전시를 손으로 추가하는 파일입니다. 화면은 `auto.json` 뒤에 이 파일을 붙여 씁니다.

- 형식은 `auto.json`과 같습니다(`schema/exhibitions.schema.json`).
- **추가만 합니다.** `id`는 `manual-`로 시작해야 하고(예: 한국문화정보원 API의 `seq`를 써서 `manual-kcisa-364451`), 한 번 정하면 바꾸지 않습니다. 찜·관람 기록이 이 `id`로 저장됩니다.
- 끝난 전시는 화면에 나오지 않습니다. 파일에서는 사람이 정리합니다.
- 같은 전시가 서울시 API로도 수집되면 자동 수집 쪽만 나오고 `manual.json` 쪽은 빠집니다(제목·기간·시설이 같으면 같은 전시로 봄). 그때는 `manual.json`에서 지웁니다.
- **운영시간은 `operatingHours`에 직접 씁니다.** 해석기를 거치지 않으므로 문구를 잘못 읽을 일이 없습니다.
  `hoursText`에는 공식 안내 문구를 화면 표시용으로 남기고, 휴관일은 `exceptions`에 날짜별로 `{ "isOpen": false, "intervals": [] }`로 씁니다.
- 시설에 연결되면 판정은 전시와 시설 중 좁은 쪽을 씁니다. 시설보다 늦게 여는 날을 빠뜨리면 그날 저녁이 "불가"가 됩니다.
- 운영시간을 시설 파일(`data/venues/`)에만 맡기려면 `scheduleType`을 `"unknown"`으로 두고 7개 요일을 `{ "isOpen": false, "intervals": [] }`로 씁니다.
  이때 `placeName`이 시설 이름·별칭과 맞아 시설에 연결되어야 합니다. 연결되지 않으면 늘 "확인 필요"가 나옵니다.
- 고친 뒤 `npm run validate`로 검사합니다.

### 보충 후보 찾기 (한국문화정보원 한눈에보는문화정보)

출처: 한국문화정보원 한눈에보는문화정보 (공공데이터포털, 이용허락범위 제한 없음).
**`manual.json` 보충 후보를 찾는 데만 쓰고 자동 수집하지 않습니다.** 배포 워크플로는 이 API를 부르지 않습니다.

- 서울시 API에 없는 종로구·중구 전시 중 `data/venues/`의 시설에 연결되는 것만 후보로 뽑습니다.
  이 API는 운영시간·휴관·입장 마감을 주지 않아서, 시설 운영시간으로 판정할 수 있는 전시만 다룹니다.
- 우선순위는 `auto.json` > `manual.json` > 이 API입니다. 같은 전시(제목·기간·시설이 같음)가 앞쪽에 있으면 "이미 있음"으로 둡니다.
- 결과는 `review/kcisa/`에만 씁니다(`candidates.md`, `candidates.json`, `manual-draft.json`). `data/`는 고치지 않습니다.
  사람이 공식 사이트에서 운영시간·휴관을 확인한 뒤 초안을 `manual.json`에 옮기고 `npm run validate`로 검사합니다.

```powershell
$env:KCISA_API_KEY = "<발급받은 키>"
npx tsx scripts/fetch-kcisa-candidates.ts            # API 호출 → review/kcisa/
npx tsx scripts/fetch-kcisa-candidates.ts --offline  # 네트워크 없이 review/kcisa/ 샘플 XML로 → review/kcisa/offline/
```

키는 환경 변수 `KCISA_API_KEY`에서만 읽습니다(`.env`를 읽지 않음). 일일 호출 한도는 10000회입니다.

### 수집 스크립트 실행

```bash
npx tsx scripts/fetch-exhibitions.ts   # data/exhibitions/auto.json 갱신
npx tsx scripts/fetch-holidays.ts      # data/holidays/holidays.json 갱신
```

`.env`가 없으면 환경 변수에서 키를 찾습니다. GitHub Actions에서는 Secrets로 주입합니다.

### 자동 수집과 배포

`.github/workflows/deploy.yml` 하나가 수집과 배포를 함께 합니다. `main`에 머지될 때,
매일 05:00(KST), 수동 실행(workflow_dispatch) 때 돌아갑니다.

1. 전시·공휴일을 새로 수집합니다. 실패한 쪽은 저장소에 있는 파일을 그대로 씁니다.
2. `scripts/validate-data.ts`로 `schema/` 형식에 맞는지 검사합니다. 어긋나면 `data/`를
   저장소 값으로 되돌려 다시 검사하고, 그래도 어긋나면 배포하지 않습니다.
3. 전시가 0건이면 저장소의 전시 파일을 씁니다.
4. 빌드해서 GitHub Pages에 배포합니다.

봇은 `main`에 커밋하지 않습니다(`main`은 보호 브랜치라 봇의 push가 GH006으로 거부됩니다).
그래서 매일 수집한 데이터는 그날 배포에만 쓰이고, 저장소의 `data/`는 자동으로 바뀌지 않습니다.
수집 결과는 실행 요약(Summary)과 `collected-data` 아티팩트(7일 보관)로 남으니,
저장소의 `data/`를 갱신하려면 아티팩트를 받거나 로컬에서 수집 스크립트를 돌려 PR로 올립니다.

## 폴더 구조

```
.github/workflows/   GitHub Actions (수집·배포)
data/                수집·조사한 JSON 데이터
schema/              data/ 각 파일의 형식 정의 (JSON Schema)
scripts/             데이터 수집·검사 스크립트 (tsx로 실행)
src/
  pages/             화면
  engine/            판정·거리·정렬 로직
  lib/               운영시간 문구 해석 등 보조 함수
  types/             공용 타입 정의 (Venue, Exhibition, JudgeInput ...)
  mock/              판정 로직 완성 전 임시 데이터
  assets/            이미지
```

## 작업 규칙

- 기능별 브랜치를 만들고 PR로 올립니다. `main`에 직접 푸시하지 않습니다.
- 머지 전 팀원 1명이 리뷰합니다.
- 공용 파일(`package.json`, `index.html`, `src/types/`)을 고칠 때는 PR 본문에 적습니다.
- 소스 파일은 UTF-8로 저장합니다.

