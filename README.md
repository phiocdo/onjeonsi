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

데이터 수집 스크립트는 `tsx`로 실행하고, 결과를 JSON 파일로 저장소에 커밋합니다.

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

## 데이터

| 파일 | 내용 | 만드는 방법 |
| --- | --- | --- |
| `data/exhibitions/auto.json` | 종로·중구 전시 | 서울시 API 자동 수집 |
| `data/holidays/holidays.json` | 공휴일 | 공공데이터포털 자동 수집 |
| `data/venues/` | 시설 운영 정보 | 사람이 직접 조사 (작성 중) |

운영시간·휴관일은 API로 제공되지 않아 손으로 조사합니다. 그래서 시설 데이터만
수동이고, 각 항목에 출처(`source`)와 확인 날짜(`verified`)를 남깁니다.

### 수집 스크립트 실행

```bash
npx tsx scripts/fetch-exhibitions.ts   # data/exhibitions/auto.json 갱신
npx tsx scripts/fetch-holidays.ts      # data/holidays/holidays.json 갱신
```

`.env`가 없으면 환경 변수에서 키를 찾습니다. GitHub Actions에서는 Secrets로 주입합니다.

## 폴더 구조

```
.github/workflows/   GitHub Actions (배포)
data/                수집·조사한 JSON 데이터
scripts/             데이터 수집 스크립트 (tsx로 실행)
src/
  pages/             화면
  types/             공용 타입 정의 (Venue, Exhibition, JudgeInput ...)
  mock/              판정 로직 완성 전 임시 데이터
  assets/            이미지
```

## 작업 규칙

- 기능별 브랜치를 만들고 PR로 올립니다. `main`에 직접 푸시하지 않습니다.
- 머지 전 팀원 1명이 리뷰합니다.
- 공용 파일(`package.json`, `index.html`, `src/types/`)을 고칠 때는 PR 본문에 적습니다.
- 소스 파일은 UTF-8로 저장합니다.

