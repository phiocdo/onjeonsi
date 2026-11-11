import { useLocation, useNavigate, useParams } from 'react-router-dom'
import exhibitions from '../../data/exhibitions/auto.json'
import {
  JUDGE_STATUS,
  exhibits,
  getStats,
  posterUrl,
  statusClass,
  type ArchiveEntry,
  type Exhibit,
  type JudgeKey,
  type Status,
} from '../mock/exhibits'
import { useArchive } from '../mock/useArchive'

const NO_INFO = '정보 없음'

type JudgeState = { result: JudgeKey; reasons: string[] }

type Detail = {
  title: string
  venue: string
  eyebrow: string
  address: string
  poster?: string
  period: string
  hours: string
  closed: string
  lastEntry: string
  entry: string
  reservation: string
  docent: string
  duration: string
  status: Status
  reason: string
  source: string
  checked: string
  official?: string
  stats?: { rating: string; time: string; crowd: string; count: number }
}

function fromMock(item: Exhibit, records: ArchiveEntry[]): Detail {
  const stats = getStats(item, records)
  return {
    title: item.name,
    venue: item.venue,
    eyebrow: `${item.venue} · ${item.area} · ${item.category}`,
    address: item.address,
    poster: posterUrl(item.poster),
    period: item.period,
    hours: item.hours,
    closed: item.closed,
    lastEntry: item.lastEntry,
    entry: item.entry,
    reservation: item.reservation,
    docent: item.docent,
    duration: `${item.duration}분`,
    status: item.status,
    reason: item.reason,
    source: item.source,
    checked: item.checked,
    official: item.official,
    stats: {
      rating: `★ ${stats.rating.toFixed(1)}`,
      time: `${stats.time}분`,
      crowd: item.crowd,
      count: stats.count,
    },
  }
}

function fromAuto(
  ex: { title: string; placeName: string; start: string; end: string; link?: string },
  judge?: JudgeState
): Detail {
  return {
    title: ex.title,
    venue: ex.placeName,
    eyebrow: ex.placeName,
    address: NO_INFO,
    period: `${ex.start} ~ ${ex.end}`,
    hours: NO_INFO,
    closed: NO_INFO,
    lastEntry: NO_INFO,
    entry: NO_INFO,
    reservation: NO_INFO,
    docent: NO_INFO,
    duration: NO_INFO,
    status: judge ? JUDGE_STATUS[judge.result] : '확인 필요',
    reason: judge
      ? judge.reasons.join(' ')
      : '이 전시의 운영 정보가 아직 등록되지 않았어요. 공식 웹사이트를 확인해 주세요.',
    source: '서울 열린데이터광장',
    checked: NO_INFO,
    official: ex.link && ex.link.startsWith('http') ? ex.link : undefined,
  }
}

function findDetail(id: string, state: unknown, records: ArchiveEntry[]): Detail | null {
  if (id.startsWith('m')) {
    const mock = exhibits.find((item) => `m${item.id}` === id)
    return mock ? fromMock(mock, records) : null
  }
  const auto = exhibitions.find((item) => String(item.id) === id)
  if (!auto) return null
  const judge = (state as { judge?: JudgeState } | null)?.judge
  return fromAuto(
    {
      title: String(auto.title),
      placeName: String(auto.placeName ?? NO_INFO),
      start: String(auto.start),
      end: String(auto.end),
      link: auto.link ? String(auto.link) : undefined,
    },
    judge
  )
}

export default function OverviewPage() {
  const { id = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { records } = useArchive()
  const detail = findDetail(id, location.state, records)

  const goBack = () => {
    if (location.key === 'default') navigate('/overview')
    else navigate(-1)
  }

  if (!detail) {
    return (
      <section>
        <button className="text-button back-button" onClick={goBack}>
          ← 뒤로
        </button>
        <p className="empty-result">전시를 찾을 수 없어요.</p>
      </section>
    )
  }

  return (
    <section>
      <button className="text-button back-button" onClick={goBack}>
        ← 뒤로
      </button>

      <div className="detail-layout">
        <div className="detail-poster">
          {detail.poster ? (
            <img src={detail.poster} alt={detail.title} decoding="async" />
          ) : (
            <div className="poster-empty">포스터 없음</div>
          )}
        </div>

        <div className="detail-content">
          <div className="detail-heading">
            <div>
              <p className="eyebrow">{detail.eyebrow}</p>
              <h2>{detail.title}</h2>
              <p>{detail.address}</p>
            </div>
            <span className={`tag ${statusClass(detail.status)}`}>{detail.status}</span>
          </div>

          <div className="detail-sections">
            <div className="info-block">
              <h3>전시 정보</h3>
              <dl>
                <dt>전시 기간</dt>
                <dd>{detail.period}</dd>
                <dt>요일별 운영</dt>
                <dd>{detail.hours}</dd>
                <dt>휴관</dt>
                <dd>{detail.closed}</dd>
                <dt>입장 마감</dt>
                <dd>{detail.lastEntry}</dd>
              </dl>
            </div>

            <div className="info-block">
              <h3>관람 안내</h3>
              <dl>
                <dt>입장 방식</dt>
                <dd>{detail.entry}</dd>
                <dt>예약 여부</dt>
                <dd>{detail.reservation}</dd>
                <dt>도슨트</dt>
                <dd>{detail.docent}</dd>
                <dt>예상 관람 시간</dt>
                <dd>{detail.duration}</dd>
              </dl>
            </div>

            <div className="info-block">
              <h3>방문 판정</h3>
              <strong className={`result-text ${statusClass(detail.status)}`}>{detail.status}</strong>
              <p>{detail.reason}</p>
              <div className="source-info">
                <span>출처: {detail.source}</span>
                <span>확인일: {detail.checked}</span>
              </div>
              <div className="link-row">
                {detail.official && (
                  <a href={detail.official} target="_blank" rel="noreferrer">
                    공식 홈페이지 ↗
                  </a>
                )}
                <a
                  href={`https://map.kakao.com/link/search/${encodeURIComponent(detail.venue)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  카카오맵 ↗
                </a>
              </div>
            </div>

            <div className="info-block">
              <h3>다른 관람자의 기록</h3>
              <div className="visitor-stats">
                <div>
                  <strong>{detail.stats?.rating ?? '준비 중'}</strong>
                  <span>평균 별점</span>
                </div>
                <div>
                  <strong>{detail.stats?.time ?? '준비 중'}</strong>
                  <span>평균 관람 시간</span>
                </div>
                <div>
                  <strong>{detail.stats?.crowd ?? '준비 중'}</strong>
                  <span>혼잡도</span>
                </div>
              </div>
              {detail.stats && <p className="subtle">익명 기록 {detail.stats.count}건 기준</p>}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}