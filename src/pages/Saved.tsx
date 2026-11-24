import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import OneExhibit, { type Status } from '../components/OneExhibit'
import SaveButton from '../components/SaveButton'
import { readVisitedIds } from '../lib/archive'
import { getCatalog, getHolidays, judgeEntry, todayInSeoul, type CatalogQuery } from '../lib/catalog'
import { SOON_DAYS, daysLeft, glanceQuery, laterEntry, periodLabel, savedStore, splitSaved, type ActiveRow, type SavedRow } from '../lib/saved'
import type { JudgeResult } from '../types'
import './Saved.css'

const STATUS: Record<JudgeResult['result'], Status> = { possible: '가능', impossible: '불가', unknown: '확인 필요' }
const GONE_LABEL: Record<SavedRow['status'], string> = { active: '', ended: '종료된 전시', unlisted: '목록에서 빠진 전시' }

// 서울 현재 날짜와 시각 조회
function NOW() {
  const now = new Date()
  return { date: todayInSeoul(now), time: now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }) }
}

// 지금 기준 판정 조건
function GLANCE() {
  const { date, time } = NOW()
  return glanceQuery(date, time)
}

// 날짜 점 구분 변환
function FORMAT(iso: string) {
  return iso.replaceAll('-', '.')
}

// 진행 중인 북마크 전시 카드. 판정은 내 주변 기본값과 같은 조건(지금부터 2시간)으로 계산하고,
// 카드를 누르면 상세 창에도 같은 조건을 넘긴다
function CARD({ row, judge, query, visited, today }: { row: ActiveRow; judge: JudgeResult; query: CatalogQuery; visited: boolean; today: string }) {
  const { entry, exhibition } = row
  const left = daysLeft(exhibition.end, today)
  const soon = left !== null && left <= SOON_DAYS
  const period = [periodLabel(exhibition.start, exhibition.end, today), exhibition.end ? `~${FORMAT(exhibition.end)}` : ''].filter(Boolean).join(' · ')
  const later = laterEntry(judge, query.stayStart)

  return (
    <div className={soon ? 'saved-card soon' : 'saved-card'}>
      <OneExhibit
        id={entry.exhibition.id}
        title={exhibition.title}
        venue={exhibition.venueName ?? '장소 미상'}
        status={STATUS[judge.result]}
        judge={judge}
        cond={query}
        poster={exhibition.imageUrl ?? undefined}
        lines={[period, later ? `${later} 입장 가능` : '', visited ? '관람 기록 있음' : '']}
      />
      <SaveButton entry={entry} className="overlay" />
    </div>
  )
}

// 끝났거나 목록에서 빠진 찜 전시. 상세 정보가 없으므로 찜할 때의 사본만 보여 준다
function GONE({ row, drop }: { row: SavedRow; drop: (ids: string[]) => void }) {
  const { item, exhibition, status } = row
  const end = exhibition.end ? ` (~${FORMAT(exhibition.end)})` : ''

  return (
    <article className="record">
      {exhibition.imageUrl && <img src={exhibition.imageUrl} alt={exhibition.title} loading="lazy" decoding="async" />}
      <div className="record-body">
        <div className="record-top">
          <strong>{exhibition.title}</strong>
          <span>{FORMAT(todayInSeoul(new Date(item.savedAt)))} 찜</span>
        </div>
        <p className="record-venue">{exhibition.venueName ?? '장소 미상'} · {GONE_LABEL[status]}{end}</p>
        <div className="record-actions">
          <button type="button" onClick={() => drop([item.exhibitionId])}>빼기</button>
        </div>
      </div>
    </article>
  )
}

// 북마크(가볼 전시) 모아보기. 상단 북마크 버튼의 '전체 보기'로 들어온다
export default function Saved() {
  const store = savedStore()
  const items = useSyncExternalStore(store.subscribe, store.getItems)
  const catalog = useMemo(() => getCatalog(), [])
  const map = useMemo(() => new Map(catalog.map((c) => [c.exhibition.id, c])), [catalog])
  // 판정 조건(내 주변 기본값과 같은 지금부터 2시간). 화면을 열 때 정하고, 다른 탭에 갔다 돌아오면 다시 정한다
  // (오래 열어 둔 화면이 몇 시간 전·어제 기준으로 남지 않게)
  const [query, setQuery] = useState(GLANCE)
  const today = query.date
  const visited = useMemo(() => readVisitedIds(), [])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') setQuery(GLANCE())
    }
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [])

  const { active, gone } = useMemo(() => splitSaved(items, (id) => map.get(id), today), [items, map, today])
  const judged = useMemo(() => {
    const holidays = getHolidays()
    return active.map((row) => ({ row, judge: judgeEntry(row.entry, query, holidays) }))
  }, [active, query])

  // 북마크에서 빼기. 저장하지 못하면 안내한다
  function DROP(ids: string[]) {
    setFailed(!store.remove(ids))
  }

  // 끝났거나 목록에서 빠진 전시 모두 빼기 (확인 후). 빠진 전시는 수집 문제로 잠시 빠졌을 수도 있어 되묻는다
  function DROP_GONE() {
    if (!window.confirm(`끝났거나 목록에서 빠진 전시 ${gone.length}개를 북마크에서 뺍니다. 되돌릴 수 없습니다.`)) return
    DROP(gone.map((r) => r.item.exhibitionId))
  }

  // 북마크 모두 지우기 (확인 후). 아카이브 전체 삭제와 따로다
  function WIPE() {
    if (!window.confirm(`북마크 ${items.length}개를 모두 지웁니다. 되돌릴 수 없습니다.`)) return
    setFailed(!store.clear())
  }

  return (
    <section className="archive-page saved-page">
      <h1>가볼 전시</h1>
      <p className="saved-note">북마크한 전시는 이 브라우저에만 저장돼요. 다른 기기나 브라우저에서는 보이지 않아요.</p>
      {failed && <p className="archive-warning" role="alert">브라우저에 저장하지 못했습니다. 잠시 후 다시 시도하십시오.</p>}

      <div className="filter-row">
        <span className="count">{active.length}개 전시 · 곧 끝나는 순 · 판정은 {query.stayStart}~{query.stayEnd} 기준 (내 주변과 같음)</span>
      </div>

      {judged.length ? (
        <div className="card-grid">
          {judged.map(({ row, judge }) => (
            <CARD key={row.item.exhibitionId} row={row} judge={judge} query={query} visited={visited.has(row.item.exhibitionId)} today={today} />
          ))}
        </div>
      ) : (
        <p className="empty-result">
          {items.length ? '지금 볼 수 있는 북마크한 전시가 없어요.' : '아직 북마크한 전시가 없어요. 전시 상세 창에서 북마크 버튼을 누르면 여기에 모여요.'}
        </p>
      )}

      {gone.length > 0 && (
        <div className="panel saved-gone">
          <div className="list-heading">
            <h2>끝났거나 목록에서 빠진 전시</h2>
            <span>{gone.length}개</span>
          </div>
          <div className="archive-tools">
            <button type="button" onClick={DROP_GONE}>모두 빼기</button>
            <span>상세 정보를 볼 수 없는 전시예요.</span>
          </div>
          <div className="record-list">
            {gone.map((row) => <GONE key={row.item.exhibitionId} row={row} drop={DROP} />)}
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div className="archive-tools saved-wipe">
          <button type="button" onClick={WIPE}>북마크 모두 지우기</button>
          <span>아카이브 전체 삭제로는 북마크가 지워지지 않아요.</span>
        </div>
      )}
    </section>
  )
}
