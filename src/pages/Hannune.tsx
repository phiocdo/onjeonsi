import { useMemo, useState, type CSSProperties } from 'react'
import OneExhibit, { type Status } from '../components/OneExhibit'
import { displayVenueName, getCatalog, getHolidays, judgeCatalog, todayInSeoul, type CatalogEntry, type JudgedEntry } from '../lib/catalog'
import type { JudgeResult } from '../types'

type Area = (typeof AREAS)[number]
type Card = { id: string; title: string; venue: string; area: string; status: Status; judge: JudgeResult; poster?: string; lines: string[] }

const AREAS = ['전체', '종로구', '중구'] as const
const STATUS: Record<JudgeResult['result'], Status> = { possible: '가능', impossible: '불가', unknown: '확인 필요' }

// 서울 현재 날짜/시각 반환
function NOW() {
  const now = new Date()
  return { date: todayInSeoul(now), time: now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }) }
}

// 구 판별
function GU(entry: CatalogEntry): string {
  const { exhibition, venue } = entry
  if (venue?.gu) return venue.gu
  const text = `${exhibition.placeName ?? ''} ${exhibition.title}`
  if (text.includes('종로')) return '종로구'
  if (text.includes('중구')) return '중구'
  return ''
}

// 선택 상태별 칩 스타일 반환
function LOOK(on: boolean): CSSProperties {
  return on ? { backgroundColor: '#d8ff3e', color: '#111111', fontWeight: 800, boxShadow: '0 0 0 2px #111111', transform: 'translateY(-1px)' } : { backgroundColor: '#ffffff', color: '#111111' }
}

// 전시 목록 항목 변환
function CARD({ entry, result }: JudgedEntry): Card {
  const { exhibition, venue } = entry
  const source = venue ? `${venue.source} · ${venue.verified}` : '서울 열린데이터광장'
  return { id: exhibition.id, title: exhibition.title, venue: displayVenueName(entry) || '장소 미상', area: GU(entry), status: STATUS[result.result], judge: result, poster: exhibition.imageUrl || undefined, lines: [`${exhibition.start} ~ ${exhibition.end}`, source] }
}

function Hannune() {
  const [area, setArea] = useState<Area>('전체')
  const { date, time } = useMemo(() => NOW(), [])
  const catalog = useMemo(() => getCatalog(), [])
  const holidays = useMemo(() => getHolidays(), [])

  const all = useMemo(() => {
    const active = catalog.filter (
      ({ exhibition }) => (!exhibition.start || exhibition.start <= date) && (!exhibition.end || exhibition.end >= date),
    )
    return judgeCatalog(active, { date, stayStart: time, stayEnd: '23:59' }, holidays).map(CARD)
  }, [catalog, holidays, date, time])

  const items = useMemo(() => all.filter((item) => area === '전체' || item.area === area), [all, area])

  return (
    <section>
      <div className="filter-row">
        <div className="chips">
          {AREAS.map((name) => (
            <button key={name} type="button" className={area === name ? 'chip chosen' : 'chip'} style={LOOK(area === name)} aria-pressed={area === name} onClick={() => setArea(name)}>
              {name}
            </button>
          ))}
        </div>
        <span className="count">{items.length}개 전시</span>
      </div>

      {items.length ? (
        <div className="card-grid">
          {items.map((item) => (
            <OneExhibit key={item.id} id={item.id} title={item.title} venue={item.venue} status={item.status} judge={item.judge} poster={item.poster} lines={item.lines} />
          ))}
        </div>
      ) : (
        <p className="empty-result">표시할 전시가 없습니다.</p>
      )}
    </section>
  )
}

export default Hannune
