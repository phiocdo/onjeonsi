import { useEffect, useMemo, useState } from 'react'
import { OPEN } from '../components/OneExhibit'
import { displayVenueName, getCatalog, todayInSeoul, type CatalogEntry } from '../lib/catalog'

type Entry = { id: string; exhibitId: string; date: string; rating: number; time: number; note: string; shared: boolean }

const RECORDS = 'onjeonsi:archive:records'
const INTERESTS = 'onjeonsi:archive:interests'
const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const STARS = [5, 4, 3, 2, 1]

// local storage 조회
function READ<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

// 날짜 문자열 점 구분 형식 변환
function FORMAT(iso: string) {
  return iso.replaceAll('-', '.')
}

// 최근 관람 기록 날짜 or 서울 오늘 날짜 반환
function LATEST(records: Entry[]) {
  return [...records].sort((a, b) => b.date.localeCompare(a.date))[0]?.date ?? todayInSeoul()
}

// 관람 기록 항목 카드
function ITEM({ entry, map, share, drop }: { entry: Entry; map: Map<string, CatalogEntry>; share: (id: string) => void; drop: (id: string) => void }) {
  const found = map.get(entry.exhibitId)
  if (!found) return null
  const { exhibition } = found
  const venue = displayVenueName(found) || '장소 미상'
  const field = exhibition.field || '전시'

  return (
    <article className="record">
      {exhibition.imageUrl && <img src={exhibition.imageUrl} alt={exhibition.title} loading="lazy" decoding="async" />}
      <div className="record-body">
        <div className="record-top">
          <strong>{exhibition.title}</strong>
          <span>{FORMAT(entry.date)}</span>
        </div>
        <p className="record-venue">{venue} · {field}</p>
        <p className="record-meta">{'★'.repeat(entry.rating)}{'☆'.repeat(5 - entry.rating)} · 실제 {entry.time}분</p>
        {entry.note && <p className="record-note">{entry.note}</p>}
        <div className="record-actions">
          <button type="button" onClick={() => OPEN(exhibition.id)}>상세 보기</button>
          <button type="button" onClick={() => share(entry.id)}>{entry.shared ? '익명 공유 중' : '비공개'}</button>
          <button type="button" onClick={() => drop(entry.id)}>삭제</button>
        </div>
      </div>
    </article>
  )
}

export default function Archive() {
  const catalog = useMemo(() => getCatalog(), [])
  const map = useMemo(() => new Map(catalog.map((c) => [c.exhibition.id, c])), [catalog])
  const fields = useMemo(() => Array.from(new Set(catalog.map((c) => c.exhibition.field).filter((f): f is string => Boolean(f)))), [catalog])
  const today = useMemo(() => todayInSeoul(), [])

  const [records, setRecords] = useState<Entry[]>(() => READ<Entry[]>(RECORDS, []))
  const [interests, setInterests] = useState<string[]>(() => READ<string[]>(INTERESTS, []))
  const [exhibit, setExhibit] = useState(() => catalog[0]?.exhibition.id ?? '')
  const [date, setDate] = useState(today)
  const [rating, setRating] = useState('5')
  const [time, setTime] = useState('70')
  const [note, setNote] = useState('')
  const [shared, setShared] = useState(false)
  const [picked, setPicked] = useState(() => LATEST(READ<Entry[]>(RECORDS, [])))
  const [view, setView] = useState(() => {
    const [year, month] = LATEST(READ<Entry[]>(RECORDS, [])).split('-').map(Number)
    return { year, month: month - 1 }
  })

  useEffect(() => {
    try { localStorage.setItem(RECORDS, JSON.stringify(records)) } catch { return }
  }, [records])

  useEffect(() => {
    try { localStorage.setItem(INTERESTS, JSON.stringify(interests)) } catch { return }
  }, [interests])

  const valid = useMemo(() => records.filter((r) => map.has(r.exhibitId)), [records, map])
  const sorted = useMemo(() => [...valid].sort((a, b) => b.date.localeCompare(a.date)), [valid])
  const dates = useMemo(() => new Set(valid.map((r) => r.date)), [valid])
  const daily = valid.filter((r) => r.date === picked)

  const liked = valid.filter((r) => r.rating >= 4)
  const genres = Array.from(new Set(liked.flatMap((r) => {
    const field = map.get(r.exhibitId)?.exhibition.field
    return field ? [field] : []
  })))
  const basis = genres.length ? genres : interests
  const seen = new Set(valid.map((r) => r.exhibitId))

  const picks = catalog.filter((c) => c.exhibition.field && basis.includes(c.exhibition.field) && !seen.has(c.exhibition.id) && c.exhibition.end >= today).slice(0, 4).map((c) => {
    const src = liked.find((r) => map.get(r.exhibitId)?.exhibition.field === c.exhibition.field)
    const name = src ? map.get(src.exhibitId)?.exhibition.title : undefined
    return { entry: c, reason: name ? `'${name}'과 같은 ${c.exhibition.field}` : `관심 분야 ${c.exhibition.field}` }
  })

  const first = new Date(view.year, view.month, 1).getDay()
  const last = new Date(view.year, view.month + 1, 0).getDate()
  const cells: (number | null)[] = [...Array<null>(first).fill(null), ...Array.from({ length: last }, (_, i) => i + 1)]

  // 연/월 기준 일자 ISO 문자열 변환
  function ISO(day: number) {
    return `${view.year}-${String(view.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  // 달력 이동
  function SHIFT(delta: number) {
    const next = new Date(view.year, view.month + delta, 1)
    setView({ year: next.getFullYear(), month: next.getMonth() })
  }

  // new 관람 기록 검증 및 저장
  function SAVE() {
    const mins = Number(time)
    if (!exhibit || !date || !mins || mins < 10 || mins > 480) return

    const entry: Entry = { id: String(Date.now()), exhibitId: exhibit, date, rating: Number(rating), time: mins, note: note.trim(), shared }
    setRecords((prev) => [entry, ...prev])
    setPicked(entry.date)
    const [year, month] = entry.date.split('-').map(Number)
    setView({ year, month: month - 1 })
    setNote('')
  }

  // 기록 공유 여부 전환
  function SHARE(id: string) {
    setRecords((prev) => prev.map((r) => (r.id === id ? { ...r, shared: !r.shared } : r)))
  }

  // 관람 기록 삭제
  function DROP(id: string) {
    setRecords((prev) => prev.filter((r) => r.id !== id))
  }

  // 관심 분야 선택
  function TOGGLE(field: string) {
    setInterests((prev) => (prev.includes(field) ? prev.filter((c) => c !== field) : [...prev, field]))
  }

  return (
    <section className="archive-page">
      <h1>아카이브</h1>

      <div className="archive-layout">
        <div className="archive-main">
          <div className="panel">
            <h2>전시 기록 남기기</h2>
            <div className="record-inputs">
              <label>
                전시
                <select value={exhibit} onChange={(e) => setExhibit(e.target.value)}>
                  {catalog.map((c) => <option key={c.exhibition.id} value={c.exhibition.id}>{c.exhibition.title} · {displayVenueName(c) || '장소 미상'}</option>)}
                </select>
              </label>
              <label>
                관람일
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label>
                별점
                <select value={rating} onChange={(e) => setRating(e.target.value)}>
                  {STARS.map((n) => <option key={n} value={n}>{'★'.repeat(n)} {n}점</option>)}
                </select>
              </label>
              <label>
                실제 관람 시간(분)
                <input type="number" min="10" max="480" value={time} onChange={(e) => setTime(e.target.value)} />
              </label>
            </div>
            <textarea placeholder="오늘의 관람 메모" value={note} onChange={(e) => setNote(e.target.value)} />
            <label className="check-row">
              <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
              <span>별점과 실제 관람 시간을 익명으로 공유하는 데 동의합니다. 다른 사용자가 전시를 고를 때 참고해요. 메모와 날짜는 공유하지 않아요.</span>
            </label>
            <button type="button" className="primary-button" onClick={SAVE}>기록 저장</button>
          </div>

          <div className="panel">
            <div className="calendar-head">
              <button type="button" onClick={() => SHIFT(-1)} aria-label="이전 달">‹</button>
              <h2>{view.year}년 {view.month + 1}월</h2>
              <button type="button" onClick={() => SHIFT(1)} aria-label="다음 달">›</button>
            </div>

            <div className="calendar-grid">
              {WEEK.map((day) => <span className="calendar-weekday" key={day}>{day}</span>)}
              {cells.map((day, idx) => day === null ? <span key={`blank-${idx}`} /> : (
                <button key={day} type="button" className={`calendar-day ${ISO(day) === picked ? 'selected' : ''} ${ISO(day) === today ? 'today' : ''}`} onClick={() => setPicked(ISO(day))}>
                  {day}
                  {dates.has(ISO(day)) && <i className="calendar-dot" />}
                </button>
              ))}
            </div>

            <div className="diary">
              <h3>{FORMAT(picked)} 일기</h3>
              {daily.length ? daily.map((entry) => <ITEM key={entry.id} entry={entry} map={map} share={SHARE} drop={DROP} />) : <p className="empty-result">이 날 남긴 기록이 없어요.</p>}
            </div>
          </div>

          <div className="panel">
            <div className="list-heading">
              <h2>전체 기록</h2>
              <span>{valid.length}개</span>
            </div>
            {sorted.length ? (
              <div className="record-list">
                {sorted.map((entry) => <ITEM key={entry.id} entry={entry} map={map} share={SHARE} drop={DROP} />)}
              </div>
            ) : (
              <p className="empty-result">아직 기록이 없어요. 위에서 첫 기록을 남겨 보세요.</p>
            )}
          </div>
        </div>

        <aside className="archive-side">
          <div className="panel recommend">
            <h2>맞춤 추천</h2>

            {genres.length ? (
              <p className="recommend-basis">높게 평가한(★4 이상) 전시와 같은 분류: {genres.join(', ')}</p>
            ) : (
              <>
                <p className="recommend-basis">{valid.length ? '★4 이상 기록이 아직 없어요. 관심 분야를 골라 주세요.' : '기록이 없어요. 관심 분야를 먼저 골라 주세요.'}</p>
                <div className="chips">
                  {fields.map((field) => (
                    <button key={field} type="button" className={interests.includes(field) ? 'chip chosen' : 'chip'} onClick={() => TOGGLE(field)}>{field}</button>
                  ))}
                </div>
              </>
            )}

            <div className="recommend-list">
              {picks.map(({ entry, reason }) => (
                <button type="button" className="recommend-item" key={entry.exhibition.id} onClick={() => OPEN(entry.exhibition.id)}>
                  {entry.exhibition.imageUrl && <img src={entry.exhibition.imageUrl} alt={entry.exhibition.title} loading="lazy" decoding="async" />}
                  <span>
                    <strong>{entry.exhibition.title}</strong>
                    <em>{displayVenueName(entry) || '장소 미상'}</em>
                    {entry.exhibition.field && <em>{entry.exhibition.field}</em>}
                    <em className="recommend-reason">{reason}</em>
                  </span>
                </button>
              ))}
              {!picks.length && basis.length > 0 && <p className="empty-result">추천할 새 전시가 없어요.</p>}
            </div>
          </div>
        </aside>
      </div>
    </section>
  )
}