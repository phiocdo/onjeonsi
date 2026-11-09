
import "./Team.css";

type MemberKey = "iljung" | "minje" | "jongmin" | "chanhui";

const MEMBERS: Record<MemberKey, string> = {
  iljung: "김일중",
  minje: "김민제",
  jongmin: "임종민",
  chanhui: "임찬희",
};

type ArchitectureNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  category: string;
  title: string;
  details: string[];
  path: string;
  owners: MemberKey[];
};

const NODES: ArchitectureNode[] = [
  {
    id: "data",
    x: 470,
    y: 155,
    width: 410,
    category: "수집 · 정리",
    title: "전시 · 시설 데이터",
    details: [
      "문화행사 자료 수집 · 전시 정보 정리",
      "시설별 운영시간 · 휴관 · 입장 마감",
      "시설 정보 · 출처 · 확인일 관리",
    ],
    path: "scripts/  ·  data/",
    owners: ["iljung", "minje"],
  },
  {
    id: "discover",
    x: 1160,
    y: 430,
    width: 410,
    category: "지도 · 탐색",
    title: "전시 탐색 · 상세 정보",
    details: [
      "내 동네 · 기준 위치 · 반경 탐색",
      "한눈에 보기 · 언제 갈까",
      "지도 · 운영 정보 · 혼잡도 확인",
    ],
    path: "src/pages/  ·  src/components/",
    owners: ["iljung", "chanhui"],
  },
  {
    id: "judge",
    x: 280,
    y: 430,
    width: 410,
    category: "조건 계산",
    title: "운영 가능 판정",
    details: [
      "전시 기간 · 휴관 여부 · 입장 마감",
      "폐관 전 종료 · 머물 수 있는 시간",
      "가능 / 불가 / 확인 필요와 판정 사유",
    ],
    path: "src/judge/  ·  src/mock/",
    owners: ["jongmin"],
  },
  {
    id: "archive",
    x: 720,
    y: 780,
    width: 440,
    category: "기록 · 추천",
    title: "관람 기록 · 맞춤 추천",
    details: [
      "방문 날짜 · 별점 · 관람 시간 · 메모",
      "개인 기록장 · 분야별 맞춤 추천",
      "동의한 기록은 익명 통계로 공유",
    ],
    path: "src/pages/  ·  src/components/  ·  localStorage",
    owners: ["chanhui", "minje", "iljung", "jongmin"],
  },
];

type EdgeProps = {
  path: string;
  label: string;
  x: number;
  y: number;
  width: number;
  dashed?: boolean;
  optional?: boolean;
};

function Edge({
  path,
  label,
  x,
  y,
  width,
  dashed = false,
  optional = false,
}: EdgeProps) {
  return (
    <g className={`arch-edge${dashed ? " arch-edge--dashed" : ""}`}>
      <path
        d={path}
        markerEnd="url(#arch-arrow)"
        className="arch-edge__path"
      />

      <g
        className={`arch-edge__label${optional ? " arch-edge__label--optional" : ""}`}
        transform={`translate(${x}, ${y})`}
      >
        <rect x={-width / 2} y={-13} width={width} height={26} rx={13} />
        <text textAnchor="middle" dominantBaseline="middle">
          {label}
        </text>
      </g>
    </g>
  );
}

function Owners({ members }: { members: MemberKey[] }) {
  return (
    <div className="arch-owners" aria-label="담당 팀원">
      {members.map((member) => (
        <span
          className={`arch-owner arch-owner--${member}`}
          key={member}
        >
          <i aria-hidden="true" />
          {MEMBERS[member]}
        </span>
      ))}
    </div>
  );
}

function Node({ node }: { node: ArchitectureNode }) {
  return (
    <article
      className={`arch-node arch-node--${node.id}`}
      style={{
        left: `${(node.x / 1440) * 100}%`,
        top: `${(node.y / 940) * 100}%`,
        width: `${(node.width / 1440) * 100}%`,
      }}
    >
      <div className="arch-node__category">{node.category}</div>

      <h3>{node.title}</h3>

      <ul>
        {node.details.map((detail) => (
          <li key={detail}>{detail}</li>
        ))}
      </ul>

      <div className="arch-node__footer">
        <span className="arch-node__path">{node.path}</span>
        <Owners members={node.owners} />
      </div>
    </article>
  );
}

function MemberLegend() {
  const order: MemberKey[] = [
    "iljung",
    "minje",
    "jongmin",
    "chanhui",
  ];

  return (
    <div className="arch-legend" aria-label="담당자 색상">
      {order.map((member) => (
        <span className={`arch-owner arch-owner--${member}`} key={member}>
          <i aria-hidden="true" />
          {MEMBERS[member]}
        </span>
      ))}
      <span className="arch-legend__optional">
        <i aria-hidden="true" />
        선택 기능
      </span>
    </div>
  );
}

export default function Team() {
  return (
    <section className="team-architecture" aria-label="온전시 프로젝트 구조">
      <MemberLegend />

      <div className="arch-scroll">
        <div className="arch-canvas">
          <svg
            className="arch-links"
            viewBox="0 0 1440 940"
            preserveAspectRatio="none"
            role="img"
            aria-label="전시 데이터, 탐색, 판정, 관람 기록 사이의 연결 관계"
          >
            <defs>
              <marker
                id="arch-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
            </defs>

            {/* 데이터에서 탐색 화면으로 */}
            <Edge
              path="M 660 185 C 770 65, 900 75, 985 315"
              label="전시 · 시설 · 위치 정보"
              x={830}
              y={105}
              width={194}
            />

            {/* 데이터에서 판정 엔진으로 */}
            <Edge
              path="M 350 248 C 260 264, 180 274, 252 315"
              label="운영시간 · 휴관 · 마감"
              x={235}
              y={278}
              width={190}
            />

            {/* 탐색 조건이 판정으로 전달 */}
            <Edge
              path="M 975 355 C 875 250, 565 250, 465 355"
              label="위치 · 반경 · 머물 시간"
              x={720}
              y={275}
              width={210}
            />

            {/* 판정 결과가 탐색 화면으로 반환 */}
            <Edge
              path="M 465 520 C 565 630, 875 630, 975 520"
              label="가능 여부 · 판정 사유"
              x={720}
              y={612}
              width={196}
            />

            {/* 탐색한 전시를 관람 기록으로 */}
            <Edge
              path="M 1210 545 C 1220 630, 1080 710, 945 758"
              label="방문 날짜 · 별점 · 메모"
              x={1150}
              y={650}
              width={200}
            />

            {/* 관람 기록에서 개인화 추천으로 */}
            <Edge
              path="M 970 800 C 1320 835, 1410 655, 1315 550"
              label="개인 추천 · 공유 통계"
              x={1290}
              y={785}
              width={190}
            />

            {/* 실제 관람 시간 통계는 선택적으로 판정에 반영 */}
            <Edge
              path="M 500 765 C 390 760, 280 660, 270 555"
              label="실제 관람시간 중앙값 반영"
              x={370}
              y={700}
              width={218}
              dashed
              optional
            />
          </svg>

          {NODES.map((node) => (
            <Node node={node} key={node.id} />
          ))}

          <div className="arch-hub">
            <span className="arch-hub__symbol" aria-hidden="true">
              온
            </span>
            <h2>온전시</h2>
            <p>
              전시를 찾고 · 가능한 시간을 확인하고
              <br />
              관람 경험을 기록하는 서비스
            </p>
          </div>
        </div>
      </div>

      <div className="arch-infra">
        <span className="arch-infra__title">자동 수집 · 배포</span>
        <span className="arch-infra__paths">
          scripts/ · data/ · .github/workflows/ · vite.config.ts
        </span>
        <Owners members={["iljung", "chanhui"]} />
      </div>
    </section>
  );
}
