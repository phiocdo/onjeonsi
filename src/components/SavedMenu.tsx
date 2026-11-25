import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { getCatalog, getHolidays, judgeEntry, todayInSeoul } from '../lib/catalog'
import { SOON_DAYS, daysLeft, glanceQuery, glanceRangeText, laterEntry, periodLabel, savedStore, splitSaved } from '../lib/saved'
import type { JudgeResult } from '../types'
import { OPEN } from './OneExhibit'
import { BookmarkIcon } from './SaveButton'
import './SavedMenu.css'

// 패널에 보여 줄 최대 개수. 나머지는 '전체 보기'에서 본다
const LIMIT = 5
const LABEL: Record<JudgeResult['result'], string> = { possible: '가능', impossible: '불가', unknown: '확인 필요' }

// 서울 현재 날짜와 시각 조회
function NOW() {
  const now = new Date()
  return { date: todayInSeoul(now), time: now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }) }
}

// 상단 북마크 버튼과 펼침 패널. 어느 화면에서든 북마크한 전시를 바로 보고 상세 창을 연다
export default function SavedMenu() {
  const store = savedStore()
  const items = useSyncExternalStore(store.subscribe, store.getItems)
  const map = useMemo(() => new Map(getCatalog().map((c) => [c.exhibition.id, c])), [])
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const panelId = useId()

  // 패널을 열 때(그리고 열린 채로 북마크가 바뀔 때) 곧 끝나는 순으로 나누고, 내 주변 기본값과 같은 조건(지금부터 2시간)으로 판정한다.
  // 항목을 누르면 상세 창에도 같은 조건을 넘겨, 패널·상세 창·내 주변의 가능/불가가 같게 나온다
  const view = useMemo(() => {
    if (!open) return null
    const { date, time } = NOW()
    const query = glanceQuery(date, time)
    const { active, gone } = splitSaved(items, (id) => map.get(id), query.date)
    const holidays = getHolidays()
    const rows = active.slice(0, LIMIT).map((row) => {
      const judge = judgeEntry(row.entry, query, holidays)
      return { row, judge, later: laterEntry(judge, query.stayStart) }
    })
    return { today: query.date, query, basis: glanceRangeText(query, time), rows, more: active.length - rows.length, gone: gone.length }
  }, [open, items, map])

  // 패널 밖을 누르거나 Esc를 누르면 닫는다
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', down)
    window.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  const extra = view ? [view.more > 0 && `외 ${view.more}개`, view.gone > 0 && `끝났거나 목록에서 빠진 전시 ${view.gone}개`].filter(Boolean).join(' · ') : ''

  return (
    <div className="saved-menu" ref={box}>
      <button
        type="button"
        className={open ? 'saved-menu-button open' : 'saved-menu-button'}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`북마크한 전시 ${items.length}개`}
        title="북마크한 전시"
        onClick={() => setOpen((v) => !v)}
      >
        <BookmarkIcon filled={items.length > 0} />
        {items.length > 0 && <span className="saved-menu-count" aria-hidden="true">{items.length}</span>}
      </button>

      {open && view && (
        <div id={panelId} className="saved-menu-panel">
          <div className="saved-menu-head">
            <strong>가볼 전시</strong>
            <span>{view.rows.length ? '끝나는 날이 가까운 순서' : ''}</span>
          </div>

          {view.rows.length ? (
            <ul className="saved-menu-list">
              {view.rows.map(({ row, judge, later }) => {
                const left = daysLeft(row.exhibition.end, view.today)
                const soon = left !== null && left <= SOON_DAYS
                const period = [periodLabel(row.exhibition.start, row.exhibition.end, view.today), later && `${later} 입장`].filter(Boolean).join(' · ')
                return (
                  <li key={row.item.exhibitionId}>
                    <button
                      type="button"
                      className="saved-menu-item"
                      onClick={() => {
                        setOpen(false)
                        OPEN(row.entry.exhibition.id, judge, view.query)
                      }}
                    >
                      {row.exhibition.imageUrl ? <img src={row.exhibition.imageUrl} alt="" loading="lazy" decoding="async" /> : <span className="saved-menu-thumb" />}
                      <span className="saved-menu-text">
                        <strong>{row.exhibition.title}</strong>
                        <span>{row.exhibition.venueName ?? '장소 미상'}</span>
                        <span className={soon ? 'saved-menu-period soon' : 'saved-menu-period'}>{period}</span>
                      </span>
                      <span className={`tag ${judge.result}`}>{LABEL[judge.result]}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="saved-menu-empty">
              {items.length ? '지금 볼 수 있는 전시가 없어요.' : '아직 북마크한 전시가 없어요. 전시 상세 창에서 북마크 버튼을 눌러 보세요.'}
            </p>
          )}

          {extra && <p className="saved-menu-more">{extra}</p>}
          {/* 배지 뜻 풀이. 기준(지금부터 2시간)은 내 주변 화면의 기본값과 같다 */}
          {view.rows.length > 0 && (
            <p className="saved-menu-basis">‘가능’·‘불가’는 {view.basis} 가서 관람을 마칠 수 있는지예요.</p>
          )}
          <Link className="saved-menu-all" to="/saved" onClick={() => setOpen(false)}>전체 보기 →</Link>
        </div>
      )}
    </div>
  )
}
