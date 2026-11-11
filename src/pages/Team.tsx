
import "./Team.css";

type MemberKey = "iljung" | "minje" | "jongmin" | "chanhui";

type RepoItem = {
  id: string;
  name: string;
  kind: "folder" | "file";
  depth: number;
  note?: string;
};

type NodeData = {
  id: string;
  x: number;
  y: number;
  width: number;
  category: string;
  title: string;
  details: string[];
  files: string[];
  owners: MemberKey[];
};

type EdgeData = {
  id: string;
  path: string;
  label: string;
  x: number;
  y: number;
  width: number;
  direction: "in" | "out" | "both";
  tone: string;
};

const MEMBERS: Record<MemberKey, string> = {
  iljung: "김일중",
  minje: "김민제",
  jongmin: "임종민",
  chanhui: "임찬희",
};

const REPO: RepoItem[] = [
  { id: "github", name: ".github", kind: "folder", depth: 0 },
  { id: "workflows", name: "workflows", kind: "folder", depth: 1 },
  { id: "data", name: "data", kind: "folder", depth: 0 },
  { id: "exhibitions", name: "exhibitions", kind: "folder", depth: 1 },
  { id: "auto", name: "auto.json", kind: "file", depth: 2, note: "서울시 API 자동 수집" },
  { id: "holidays", name: "holidays", kind: "folder", depth: 1 },
  { id: "holiday-json", name: "holidays.json", kind: "file", depth: 2, note: "공공데이터포털 자동 수집" },
  { id: "venues", name: "venues", kind: "folder", depth: 1, note: "작성 중 · 직접 조사" },
  { id: "public", name: "public", kind: "folder", depth: 0 },
  { id: "scripts", name: "scripts", kind: "folder", depth: 0 },
  { id: "fetch-exhibitions", name: "fetch-exhibitions.ts", kind: "file", depth: 1 },
  { id: "fetch-holidays", name: "fetch-holidays.ts", kind: "file", depth: 1 },
  { id: "src", name: "src", kind: "folder", depth: 0 },
  { id: "assets", name: "assets", kind: "folder", depth: 1 },
  { id: "engine", name: "engine", kind: "folder", depth: 1 },
  { id: "constants", name: "constants.ts", kind: "file", depth: 2 },
  { id: "judge", name: "judge.ts", kind: "file", depth: 2 },
  { id: "reasons", name: "reasons.ts", kind: "file", depth: 2 },
  { id: "sanity", name: "sanity.test.ts", kind: "file", depth: 2 },
  { id: "mock", name: "mock", kind: "folder", depth: 1 },
  { id: "mock-data", name: "data.ts", kind: "file", depth: 2 },
  { id: "pages", name: "pages", kind: "folder", depth: 1 },
  { id: "archive", name: "Archive.tsx", kind: "file", depth: 2 },
  { id: "nearby-css", name: "NearbyExhibitions.css", kind: "file", depth: 2 },
  { id: "nearby", name: "NearbyExhibitions.tsx", kind: "file", depth: 2 },
  { id: "overview-list", name: "OverviewList.tsx", kind: "file", depth: 2 },
  { id: "overview-page", name: "OverviewPage.tsx", kind: "file", depth: 2 },
  { id: "team-css", name: "Team.css", kind: "file", depth: 2 },
  { id: "team", name: "Team.tsx", kind: "file", depth: 2, note: "현재 프로젝트 구조도" },
  { id: "when", name: "When.tsx", kind: "file", depth: 2 },
  { id: "types", name: "types", kind: "folder", depth: 1 },
  { id: "types-index", name: "index.ts", kind: "file", depth: 2 },
  { id: "app", name: "App.tsx", kind: "file", depth: 1 },
  { id: "index-css", name: "index.css", kind: "file", depth: 1 },
  { id: "main", name: "main.tsx", kind: "file", depth: 1 },
  { id: "env", name: ".env.example", kind: "file", depth: 0 },
  { id: "gitignore", name: ".gitignore", kind: "file", depth: 0 },
  { id: "readme", name: "README.md", kind: "file", depth: 0 },
  { id: "eslint", name: "eslint.config.js", kind: "file", depth: 0 },
  { id: "html", name: "index.html", kind: "file", depth: 0 },
  { id: "lock", name: "package-lock.json", kind: "file", depth: 0 },
  { id: "package", name: "package.json", kind: "file", depth: 0 },
  { id: "tsconfig-app", name: "tsconfig.app.json", kind: "file", depth: 0 },
  { id: "tsconfig", name: "tsconfig.json", kind: "file", depth: 0 },
  { id: "tsconfig-node", name: "tsconfig.node.json", kind: "file", depth: 0 },
  { id: "vite", name: "vite.config.ts", kind: "file", depth: 0 },
];

const NODES: NodeData[] = [
  {
    id: "pipeline",
    x: 30,
    y: 280,
    width: 350,
    category: "DATA PIPELINE",
    title: "데이터 수집 · 정리",
    details: [
      "서울시 API에서 종로 · 중구 전시 수집",
      "공공데이터포털에서 공휴일 수집",
      "시설 운영 정보는 직접 조사",
    ],
    files: ["scripts/", "data/exhibitions/", "data/holidays/", "data/venues/"],
    owners: ["iljung", "minje"],
  },
  {
    id: "judge",
    x: 30,
    y: 790,
    width: 350,
    category: "JUDGEMENT ENGINE",
    title: "운영 가능 판정",
    details: [
      "전시 기간 · 휴관 · 입장 마감 확인",
      "폐관 전 관람 종료 및 머물 시간 계산",
      "가능 · 불가 · 확인 필요와 판정 사유",
    ],
    files: ["src/engine/", "src/mock/", "src/types/"],
    owners: ["jongmin"],
  },
  {
    id: "discover",
    x: 1220,
    y: 280,
    width: 350,
    category: "EXHIBITION DISCOVERY",
    title: "내 동네 · 전시 탐색",
    details: [
      "카카오맵 · 기준 위치 · 반경 탐색",
      "한눈에 보기 · 전시 상세 정보",
      "언제 갈까 · 시간대별 운영 가능 판정",
    ],
    files: ["NearbyExhibitions.tsx", "OverviewPage.tsx", "When.tsx"],
    owners: ["iljung", "chanhui"],
  },
  {
    id: "archive",
    x: 1220,
    y: 790,
    width: 350,
    category: "PERSONAL ARCHIVE",
    title: "관람 기록 · 맞춤 추천",
    details: [
      "방문 날짜 · 별점 · 실제 관람 시간",
      "개인 기록장 · 날짜별 메모",
      "동의한 기록을 익명 통계로 활용",
    ],
    files: ["src/pages/Archive.tsx"],
    owners: ["chanhui", "minje", "iljung", "jongmin"],
  },
  {
    id: "deploy",
    x: 625,
    y: 1190,
    width: 350,
    category: "AUTOMATION · DEPLOY",
    title: "자동 수집 · 빌드 · 배포",
    details: [
      "GitHub Actions 워크플로",
      "Vite 설정 및 빌드",
      "GitHub Pages 배포",
    ],
    files: [".github/workflows/", "vite.config.ts", "package.json"],
    owners: ["iljung", "chanhui"],
  },
];

const EDGES: EdgeData[] = [
  {
    id: "collect-exhibitions",
    path: "M 380 350 C 420 350 430 392 470 392",
    label: "전시 수집",
    x: 420,
    y: 328,
    width: 90,
    direction: "in",
    tone: "data",
  },
  {
    id: "collect-holidays",
    path: "M 380 405 C 420 405 430 410 470 410",
    label: "공휴일 수집",
    x: 420,
    y: 435,
    width: 100,
    direction: "in",
    tone: "data",
  },
  {
    id: "data-to-discover",
    path: "M 1130 284 C 1170 284 1175 350 1220 350",
    label: "전시 데이터",
    x: 1175,
    y: 265,
    width: 100,
    direction: "out",
    tone: "data",
  },
  {
    id: "holiday-to-judge",
    path: "M 470 320 C 420 350 420 840 380 840",
    label: "공휴일 정보",
    x: 420,
    y: 635,
    width: 100,
    direction: "out",
    tone: "engine",
  },
  {
    id: "engine",
    path: "M 470 500 C 420 500 420 880 380 880",
    label: "판정 로직 · 결과",
    x: 420,
    y: 690,
    width: 125,
    direction: "both",
    tone: "engine",
  },
  {
    id: "pages",
    path: "M 1130 644 C 1175 644 1175 420 1220 420",
    label: "탐색 화면",
    x: 1175,
    y: 565,
    width: 90,
    direction: "both",
    tone: "discover",
  },
  {
    id: "archive",
    path: "M 1130 608 C 1175 608 1175 875 1220 875",
    label: "관람 기록",
    x: 1175,
    y: 740,
    width: 90,
    direction: "both",
    tone: "archive",
  },
  {
    id: "workflows",
    path: "M 470 230 C 410 230 410 1260 625 1260",
    label: "자동 실행",
    x: 430,
    y: 1150,
    width: 90,
    direction: "out",
    tone: "deploy",
  },
  {
    id: "vite",
    path: "M 1130 1022 C 1190 1060 1190 1260 975 1260",
    label: "빌드 · 배포 설정",
    x: 1170,
    y: 1150,
    width: 125,
    direction: "out",
    tone: "deploy",
  },
];

const ORDER: MemberKey[] = ["iljung", "minje", "jongmin", "chanhui"];

// 담당자 표시
function A({ members }: { members: MemberKey[] }) {
  return (
    <div className="arch-owners" aria-label="담당 팀원">
      {members.map((member) => (
        <span className={`arch-owner arch-owner--${member}`} key={member}>
          <i aria-hidden="true" />
          {MEMBERS[member]}
        </span>
      ))}
    </div>
  );
}

// 저장소 목록 표시
function B() {
  return (
    <section className="arch-repo" aria-label="GitHub 저장소 구조">
      <header className="arch-repo__header">
        <div className="arch-repo__identity">
          <span className="arch-repo__icon" aria-hidden="true">
            <i />
          </span>
          <div>
            <span className="arch-repo__eyebrow">PROJECT REPOSITORY</span>
            <h2>onjeonsi</h2>
          </div>
        </div>
        <span className="arch-repo__branch">main</span>
      </header>

      <div className="arch-repo__summary">
        <span><i className="arch-dot" /> TypeScript</span>
        <span>React</span>
        <span>Vite</span>
        <span>GitHub Pages</span>
      </div>

      <div className="arch-repo__tree">
        <div className="arch-repo__tree-head">
          <span>NAME</span>
          <span>DESCRIPTION</span>
        </div>

        {REPO.map((item) => (
          <div
            className={`arch-file${item.kind === "folder" ? " arch-file--folder" : ""}${item.id === "venues" ? " arch-file--pending" : ""}`}
            style={{ paddingLeft: `${14 + item.depth * 18}px` }}
            key={item.id}
          >
            <span className="arch-file__name">
              <i className={item.kind === "folder" ? "arch-folder" : "arch-document"} />
              {item.name}
              {item.kind === "folder" && <span>/</span>}
            </span>
            <span className="arch-file__note">{item.note ?? ""}</span>
          </div>
        ))}
      </div>

      <footer className="arch-repo__footer">
        <span>EXPANDED DIRECTORY TREE</span>
        <span>{REPO.length} ITEMS</span>
      </footer>
    </section>
  );
}

// 연결 화살표 표시
function C({ edge }: { edge: EdgeData }) {
  return (
    <g className={`arch-edge arch-edge--${edge.tone}`}>
      <path
        d={edge.path}
        markerStart={edge.direction === "both" ? "url(#arch-arrow)" : undefined}
        markerEnd="url(#arch-arrow)"
        className="arch-edge__path"
      />
      <g className="arch-edge__label" transform={`translate(${edge.x}, ${edge.y})`}>
        <rect x={-edge.width / 2} y={-12} width={edge.width} height={24} rx={12} />
        <text textAnchor="middle" dominantBaseline="middle">{edge.label}</text>
      </g>
    </g>
  );
}

// 기능 영역 표시
function D({ node }: { node: NodeData }) {
  return (
    <article
      className={`arch-node arch-node--${node.id}`}
      style={{
        left: `${(node.x / 1600) * 100}%`,
        top: `${(node.y / 1420) * 100}%`,
        width: `${(node.width / 1600) * 100}%`,
      }}
    >
      <div className="arch-node__category">{node.category}</div>
      <h3>{node.title}</h3>
      <ul>
        {node.details.map((detail) => <li key={detail}>{detail}</li>)}
      </ul>
      <div className="arch-node__files">
        {node.files.map((file) => <span key={file}>{file}</span>)}
      </div>
      <A members={node.owners} />
    </article>
  );
}

// 담당자 범례 표시
function E() {
  return (
    <div className="arch-legend" aria-label="담당자 색상">
      {ORDER.map((member) => (
        <span className={`arch-owner arch-owner--${member}`} key={member}>
          <i aria-hidden="true" />
          {MEMBERS[member]}
        </span>
      ))}
    </div>
  );
}

// 저장소 중심 관계도 표시
export default function MAIN() {
  return (
    <section className="team-architecture" aria-label="온전시 GitHub 저장소 중심 관계도">
      <E />

      <div className="arch-scroll">
        <div className="arch-canvas">
          <svg
            className="arch-links"
            viewBox="0 0 1600 1420"
            preserveAspectRatio="none"
            role="img"
            aria-label="GitHub 저장소의 파일과 프로젝트 기능 사이의 연결 관계"
          >
            <defs>
              <marker id="arch-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
            </defs>
            {EDGES.map((edge) => <C edge={edge} key={edge.id} />)}
          </svg>

          {NODES.map((node) => <D node={node} key={node.id} />)}

          <B />

          <div className="arch-caption">
            <span>REPOSITORY ARCHITECTURE</span>
            <span>DATA → ENGINE → SERVICE → ARCHIVE</span>
          </div>
        </div>
      </div>
    </section>
  );
}
