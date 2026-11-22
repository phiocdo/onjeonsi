import { useEffect, useMemo, useState } from 'react'
import { OPEN } from '../components/OneExhibit'
import { displayVenueName, getCatalog, todayInSeoul, type CatalogEntry } from '../lib/catalog'
import { fromVisitRecord, getRatingSummary } from '../lib/ratings'
import { recommendPersonal, type Candidate } from '../lib/recommend'
import {
  ARCHIVE_KEY,
  browserStorage,
  buildExport,
  clearArchive,
  createRecord,
  emptyArchive,
  exportFileName,
  loadArchive,
  saveArchive,
  viewOf,
  type RecordStatus,
} from '../lib/archive'
import type { ArchiveData, VisitRecord } from '../types/records'

const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const STARS = [5, 4, 3, 2, 1]
// 카탈로그에 없는 전시 표시 문구
const STATUS_LABEL: Record<RecordStatus, string> = { listed: '', ended: ' · 종료된 전시', unlisted: ' · 목록에서 빠진 전시' }

// 날짜 점 구분 변환
function FORMAT(iso: string) {
  return iso.replaceAll('-', '.')
}

// 최근 관람 기록 날짜
function LATEST(records: VisitRecord[]) {
  return [...records].sort((a, b) => b.date.localeCompare(a.date))[0]?.date ?? todayInSeoul()
}

// 같은 관람일이면 나중에 만든 기록이 위로 오게 정렬
function NEWEST(a: VisitRecord, b: VisitRecord) {
  return b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
}

// 관람 기록 항목. 카탈로그에 전시가 없으면(끝난 전시) 기록할 때 복사해 둔 정보를 보여 준다
function ITEM({ entry, found, today, share, drop }: { entry: VisitRecord; found: CatalogEntry | undefined; today: string; share: (id: string) => void; drop: (id: string) => void }) {
  const view = viewOf(entry, found, today)
  const venue = view.venueName || '장소 미상'
  const field = view.field || '전시'

  return (
    <article className="record">
      {view.imageUrl && <img src={view.imageUrl} alt={view.title} loading="lazy" decoding="async" />}
      <div className="record-body">
        <div className="record-top">
          <strong>{view.title}</strong>
          <span>{FORMAT(entry.date)}</span>
        </div>
        <p className="record-venue">{venue} · {field}{STATUS_LABEL[view.status]}</p>
        <p className="record-meta">{'★'.repeat(entry.rating)}{'☆'.repeat(5 - entry.rating)} · 실제 {entry.visitMinutes}분</p>
        {entry.note && <p className="record-note">{entry.note}</p>}
        <div className="record-actions">
          {view.status === 'listed' && <button type="button" onClick={() => OPEN(entry.exhibitionId)}>상세 보기</button>}
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
  const storage = useMemo(() => browserStorage(), [])

  // 처음 읽을 때 예전 형식(v1)이면 v2로 옮겨 저장한다
  const [loaded] = useState(() => loadArchive(storage, (id) => map.get(id)))
  const [archive, setArchive] = useState<ArchiveData>(loaded.data)
  const [saveFailed, setSaveFailed] = useState(loaded.saveFailed)
  const [exhibit, setExhibit] = useState(() => catalog[0]?.exhibition.id ?? '')
  const [date, setDate] = useState(today)
  const [rating, setRating] = useState('5')
  const [time, setTime] = useState('70')
  const [note, setNote] = useState('')
  const [shared, setShared] = useState(false)
  const [picked, setPicked] = useState(() => LATEST(archive.records))
  const [view, setView] = useState(() => {
    const [year, month] = LATEST(archive.records).split('-').map(Number)
    return { year, month: month - 1 }
  })

  // 다른 탭에서 아카이브를 바꾸면 다시 읽는다. 오래된 상태로 저장해 다른 탭의 변경을 덮어쓰지 않게 한다
  // (key가 null이면 다른 탭에서 localStorage.clear()를 부른 것)
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== ARCHIVE_KEY && e.key !== null) return
      setArchive(loadArchive(storage, (id) => map.get(id)).data)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [storage, map])

  const { records, interests } = archive
  const sorted = useMemo(() => [...records].sort(NEWEST), [records])
  const dates = useMemo(() => new Set(records.map((r) => r.date)), [records])
  const daily = sorted.filter((r) => r.date === picked)

  const liked = records.filter((r) => r.rating >= 4)
  const genres = Array.from(new Set(liked.flatMap((r) => (r.exhibition.field ? [r.exhibition.field] : []))))
  const basis = genres.length ? genres : interests
  const picks = useMemo(() => {
    const candidates: Candidate[] = catalog.filter((c) => c.exhibition.end >= today).map((c) => ({ id: c.exhibition.id, venueId: c.venue?.id ?? null, field: c.exhibition.field ?? null, distanceM: null, result: 'possible' }))
    // 분야는 전시 정보 사본에서 가져온다 (카탈로그에 있으면 읽을 때 최신으로 고쳐져 있다)
    const myRecords = records.map((r) => ({ ...fromVisitRecord(r), field: r.exhibition.field }))
    const ratingOf = (c: Candidate) => getRatingSummary(c.id, c.venueId, { shared: [], seed: [] })
    const { items } = recommendPersonal(candidates, { myRecords, interests, seenIds: records.map((r) => r.exhibitionId), ratingOf, popularVenueIds: [], limit: 4 })
    return items.flatMap((item) => {
      const entry = map.get(item.id)
      return entry ? [{ entry, reason: item.reason }] : []
    })
  }, [catalog, today, records, map, interests])

  const first = new Date(view.year, view.month, 1).getDay()
  const last = new Date(view.year, view.month + 1, 0).getDate()
  const cells: (number | null)[] = [...Array<null>(first).fill(null), ...Array.from({ length: last }, (_, i) => i + 1)]

  // 년/월 기준 일자 문자열 변환
  function ISO(day: number) {
    return `${view.year}-${String(view.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  // 달력 월 이동
  function SHIFT(delta: number) {
    const next = new Date(view.year, view.month + delta, 1)
    setView({ year: next.getFullYear(), month: next.getMonth() })
  }

  // 아카이브 상태 변경 + 브라우저 저장
  function UPDATE(change: (prev: ArchiveData) => ArchiveData) {
    const next = change(archive)
    setArchive(next)
    setSaveFailed(!saveArchive(storage, next))
  }

  // 관람 기록 검증 및 저장
  function SAVE() {
    const found = map.get(exhibit)
    if (!found) return

    // 별점·관람 시간(10~480분 정수, 소수는 반올림)·날짜 검증은 createRecord가 한다
    const entry = createRecord({ entry: found, date, rating: Number(rating), visitMinutes: Number(time), note, shared })
    if (!entry) return
    UPDATE((prev) => ({ ...prev, records: [entry, ...prev.records] }))
    setPicked(entry.date)
    const [year, month] = entry.date.split('-').map(Number)
    setView({ year, month: month - 1 })
    setNote('')
  }

  // 기록 공유 상태
  function SHARE(id: string) {
    UPDATE((prev) => ({ ...prev, records: prev.records.map((r) => (r.id === id ? { ...r, shared: !r.shared } : r)) }))
  }

  // 관람 기록 삭제 (확인 후)
  function DROP(id: string) {
    if (!window.confirm('이 기록을 삭제하시겠습니까? 되돌릴 수 없습니다.')) return
    UPDATE((prev) => ({ ...prev, records: prev.records.filter((r) => r.id !== id) }))
  }

  // 관심 분야 토글
  function TOGGLE(field: string) {
    UPDATE((prev) => ({ ...prev, interests: prev.interests.includes(field) ? prev.interests.filter((c) => c !== field) : [...prev.interests, field] }))
  }

  // 아카이브 JSON 파일로 내려받기
  function EXPORT() {
    const now = new Date()
    const blob = new Blob([JSON.stringify(buildExport(archive, now), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = exportFileName(now)
    document.body.appendChild(link)
    link.click()
    link.remove()
    // 바로 해제하면 일부 브라우저(특히 모바일)에서 내려받기가 시작되기 전에 취소되어 1초 늦춘다
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // 아카이브 전체 삭제 (확인 후)
  function WIPE() {
    if (!window.confirm(`기록 ${records.length}개와 관심 분야를 모두 삭제합니다. 되돌릴 수 없습니다.\n먼저 내보내기로 백업해 두십시오.`)) return
    // 저장소에서 지우지 못했으면 화면도 그대로 둔다 (화면만 비우면 새로고침 때 기록이 되살아나 헷갈린다)
    if (!clearArchive(storage)) {
      window.alert('브라우저 저장소에서 삭제하지 못했습니다. 잠시 후 다시 시도하십시오.')
      return
    }
    setSaveFailed(false)
    setArchive(emptyArchive())
    setPicked(today)
    const [year, month] = today.split('-').map(Number)
    setView({ year, month: month - 1 })
  }

  return (
    <section className="archive-page">
      <h1>아카이브</h1>

      <div className="archive-layout">
        <div className="archive-main">
          {saveFailed && <p className="archive-warning">브라우저에 저장하지 못했습니다. 새로고침하면 바뀐 내용이 사라질 수 있으니 내보내기로 백업해 두십시오.</p>}

          <div className="panel">
            <h2>기록</h2>
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
                  {STARS.map((n) => <option key={n} value={n}>{'★'.repeat(n)}</option>)}
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
              <span>별점과 실제 관람 시간을 익명으로 공유하는 데 동의합니다. 다른 사용자가 전시를 고를 때 참고합니다. 메모와 날짜는 공유하지 않습니다.</span>
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
              {daily.length ? daily.map((entry) => <ITEM key={entry.id} entry={entry} found={map.get(entry.exhibitionId)} today={today} share={SHARE} drop={DROP} />) : <p className="empty-result">이 날 남긴 기록이 없어요.</p>}
            </div>
          </div>

          <div className="panel">
            <div className="list-heading">
              <h2>전체 기록</h2>
              <span>{records.length}개</span>
            </div>
            <div className="archive-tools">
              <button type="button" onClick={EXPORT} disabled={!records.length && !interests.length}>내보내기(JSON)</button>
              <button type="button" onClick={WIPE} disabled={!records.length && !interests.length}>아카이브 전체 삭제</button>
              <span>내보낸 파일에는 메모도 포함됩니다.</span>
            </div>
            {sorted.length ? (
              <div className="record-list">
                {sorted.map((entry) => <ITEM key={entry.id} entry={entry} found={map.get(entry.exhibitionId)} today={today} share={SHARE} drop={DROP} />)}
              </div>
            ) : (
              <p className="empty-result">아직 기록이 없습니다. 위에서 첫 기록을 남기십시오.</p>
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
                <p className="recommend-basis">{records.length ? '★4 이상 기록이 아직 없습니다. 관심 분야를 선택하십시오.' : '기록이 없습니다. 관심 분야를 먼저 선택하십시오.'}</p>
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
              {!picks.length && basis.length > 0 && <p className="empty-result">추천할 새 전시가 없습니다.</p>}
            </div>
          </div>
        </aside>
      </div>
    </section>
  )
}
