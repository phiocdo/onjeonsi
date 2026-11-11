import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  categories,
  exhibitById,
  exhibits,
  formatDate,
  posterUrl,
  todayIso,
  type ArchiveEntry,
  type Category,
} from '../mock/exhibits'
import { useArchive } from '../mock/useArchive'

const weekdays = ['일', '월', '화', '수', '목', '금', '토']

function latestDate(records: ArchiveEntry[]) {
  return [...records].sort((a, b) => b.date.localeCompare(a.date))[0]?.date ?? todayIso()
}

function RecordItem({
  entry,
  onToggleShare,
  onDelete,
}: {
  entry: ArchiveEntry
  onToggleShare: (id: string) => void
  onDelete: (id: string) => void
}) {
  const item = exhibitById(entry.exhibitId)
  if (!item) return null

  return (
    <article className="record">
      <img src={posterUrl(item.poster)} alt={item.name} loading="lazy" decoding="async" />
      <div className="record-body">
        <div className="record-top">
          <strong>{item.name}</strong>
          <span>{formatDate(entry.date)}</span>
        </div>
        <p className="record-venue">
          {item.venue} · {item.category}
        </p>
        <p className="record-meta">
          {'★'.repeat(entry.rating)}
          {'☆'.repeat(5 - entry.rating)} · 실제 {entry.time}분
        </p>
        {entry.note && <p className="record-note">{entry.note}</p>}
        <div className="record-actions">
          <button onClick={() => onToggleShare(entry.id)}>
            {entry.shared ? '익명 공유 중' : '비공개'}
          </button>
          <button onClick={() => onDelete(entry.id)}>삭제</button>
        </div>
      </div>
    </article>
  )
}

export default function Archive() {
  const navigate = useNavigate()
  const { records, setRecords, interests, setInterests } = useArchive()

  const [formExhibit, setFormExhibit] = useState(String(exhibits[0]?.id ?? 1))
  const [formDate, setFormDate] = useState(todayIso())
  const [formRating, setFormRating] = useState('5')
  const [formTime, setFormTime] = useState('70')
  const [formNote, setFormNote] = useState('')
  const [formShared, setFormShared] = useState(false)
  const [selectedDate, setSelectedDate] = useState(() => latestDate(records))
  const [view, setView] = useState(() => {
    const [year, month] = latestDate(records).split('-').map(Number)
    return { year, month: month - 1 }
  })

  const sortedRecords = useMemo(
    () => [...records].sort((a, b) => b.date.localeCompare(a.date)),
    [records]
  )
  const recordDates = useMemo(() => new Set(records.map((record) => record.date)), [records])
  const dayRecords = records.filter((record) => record.date === selectedDate)

  const likedRecords = records.filter((record) => record.rating >= 4)
  const likedCategories = Array.from(
    new Set(
      likedRecords.flatMap((record) => {
        const category = exhibitById(record.exhibitId)?.category
        return category ? [category] : []
      })
    )
  )
  const basis = likedCategories.length ? likedCategories : interests
  const recordedIds = new Set(records.map((record) => record.exhibitId))

  const recommendations = exhibits
    .filter((item) => basis.includes(item.category) && !recordedIds.has(item.id))
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 4)
    .map((item) => {
      const source = likedRecords.find(
        (record) => exhibitById(record.exhibitId)?.category === item.category
      )
      const sourceName = source ? exhibitById(source.exhibitId)?.name : undefined
      return {
        item,
        reason: sourceName
          ? `'${sourceName}'과 같은 ${item.category}`
          : `관심 분야 ${item.category}`,
      }
    })

  const firstDay = new Date(view.year, view.month, 1).getDay()
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array<null>(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  const today = todayIso()

  function toIso(day: number) {
    return `${view.year}-${String(view.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  function shiftMonth(delta: number) {
    const next = new Date(view.year, view.month + delta, 1)
    setView({ year: next.getFullYear(), month: next.getMonth() })
  }

  function saveEntry() {
    const time = Number(formTime)
    if (!formDate || !time || time < 1) return

    const entry: ArchiveEntry = {
      id: String(Date.now()),
      exhibitId: Number(formExhibit),
      date: formDate,
      rating: Number(formRating),
      time,
      note: formNote.trim(),
      shared: formShared,
    }

    setRecords((prev) => [entry, ...prev])
    setSelectedDate(entry.date)
    const [year, month] = entry.date.split('-').map(Number)
    setView({ year, month: month - 1 })
    setFormNote('')
  }

  function toggleShare(id: string) {
    setRecords((prev) =>
      prev.map((record) => (record.id === id ? { ...record, shared: !record.shared } : record))
    )
  }

  function deleteEntry(id: string) {
    setRecords((prev) => prev.filter((record) => record.id !== id))
  }

  function toggleInterest(category: Category) {
    setInterests((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]
    )
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
                <select value={formExhibit} onChange={(e) => setFormExhibit(e.target.value)}>
                  {exhibits.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.venue}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                관람일
                <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} />
              </label>
              <label>
                별점
                <select value={formRating} onChange={(e) => setFormRating(e.target.value)}>
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {'★'.repeat(n)} {n}점
                    </option>
                  ))}
                </select>
              </label>
              <label>
                실제 관람 시간(분)
                <input
                  type="number"
                  min="1"
                  value={formTime}
                  onChange={(e) => setFormTime(e.target.value)}
                />
              </label>
            </div>
            <textarea
              placeholder="오늘의 관람 메모"
              value={formNote}
              onChange={(e) => setFormNote(e.target.value)}
            />
            <label className="check-row">
              <input
                type="checkbox"
                checked={formShared}
                onChange={(e) => setFormShared(e.target.checked)}
              />
              <span>
                별점과 실제 관람 시간을 익명으로 공유하는 데 동의합니다. 다른 사용자가 전시를 고를 때
                참고해요. 메모와 날짜는 공유하지 않아요.
              </span>
            </label>
            <button className="primary-button" onClick={saveEntry}>
              기록 저장
            </button>
          </div>

          <div className="panel">
            <div className="calendar-head">
              <button onClick={() => shiftMonth(-1)} aria-label="이전 달">
                ‹
              </button>
              <h2>
                {view.year}년 {view.month + 1}월
              </h2>
              <button onClick={() => shiftMonth(1)} aria-label="다음 달">
                ›
              </button>
            </div>

            <div className="calendar-grid">
              {weekdays.map((day) => (
                <span className="calendar-weekday" key={day}>
                  {day}
                </span>
              ))}
              {cells.map((day, index) =>
                day === null ? (
                  <span key={`blank-${index}`} />
                ) : (
                  <button
                    key={day}
                    className={`calendar-day ${toIso(day) === selectedDate ? 'selected' : ''} ${
                      toIso(day) === today ? 'today' : ''
                    }`}
                    onClick={() => setSelectedDate(toIso(day))}
                  >
                    {day}
                    {recordDates.has(toIso(day)) && <i className="calendar-dot" />}
                  </button>
                )
              )}
            </div>

            <div className="diary">
              <h3>{formatDate(selectedDate)} 일기</h3>
              {dayRecords.length ? (
                dayRecords.map((entry) => (
                  <RecordItem
                    key={entry.id}
                    entry={entry}
                    onToggleShare={toggleShare}
                    onDelete={deleteEntry}
                  />
                ))
              ) : (
                <p className="empty-result">이 날 남긴 기록이 없어요.</p>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="list-heading">
              <h2>전체 기록</h2>
              <span>{records.length}개</span>
            </div>
            {sortedRecords.length ? (
              <div className="record-list">
                {sortedRecords.map((entry) => (
                  <RecordItem
                    key={entry.id}
                    entry={entry}
                    onToggleShare={toggleShare}
                    onDelete={deleteEntry}
                  />
                ))}
              </div>
            ) : (
              <p className="empty-result">아직 기록이 없어요. 위에서 첫 기록을 남겨 보세요.</p>
            )}
          </div>
        </div>

        <aside className="archive-side">
          <div className="panel recommend">
            <h2>맞춤 추천</h2>

            {likedCategories.length ? (
              <p className="recommend-basis">
                높게 평가한(★4 이상) 전시와 같은 분류: {likedCategories.join(', ')}
              </p>
            ) : (
              <>
                <p className="recommend-basis">
                  {records.length
                    ? '★4 이상 기록이 아직 없어요. 관심 분야를 골라 주세요.'
                    : '기록이 없어요. 관심 분야를 먼저 골라 주세요.'}
                </p>
                <div className="chips">
                  {categories.map((category) => (
                    <button
                      key={category}
                      className={interests.includes(category) ? 'chip chosen' : 'chip'}
                      onClick={() => toggleInterest(category)}
                    >
                      {category}
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="recommend-list">
              {recommendations.map(({ item, reason }) => (
                <button
                  className="recommend-item"
                  key={item.id}
                  onClick={() => navigate(`/overview/m${item.id}`)}
                >
                  <img src={posterUrl(item.poster)} alt={item.name} loading="lazy" decoding="async" />
                  <span>
                    <strong>{item.name}</strong>
                    <em>{item.venue}</em>
                    <em>
                      ★ {item.rating.toFixed(1)} · {item.category}
                    </em>
                    <em className="recommend-reason">{reason}</em>
                  </span>
                </button>
              ))}
              {!recommendations.length && basis.length > 0 && (
                <p className="empty-result">추천할 새 전시가 없어요.</p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </section>
  )
}