import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { calculateDistance, type Coordinate } from '../engine/distance'
import { rankExhibitions } from '../engine/sort'
import { basisLabel, displayLocation, displayVenueName, getCatalog, getHolidays, judgeCatalog, todayInSeoul, type JudgedEntry } from '../lib/catalog'
import type { JudgeResult } from '../types'
import OneExhibit, { OPEN } from '../components/OneExhibit'
import './NearbyExhibitions.css'

interface LatLng { getLat: () => number; getLng: () => number }
interface Layer { setMap: (map: unknown) => void }
interface InfoBox { close: () => void; setContent: (el: HTMLElement) => void; setPosition: (pos: LatLng) => void; open: (map: unknown) => void }
interface Region { region_type: string; region_2depth_name: string; region_3depth_name: string }
interface Kakao {
  maps: {
    load: (fn: () => void) => void
    Map: new (el: HTMLElement, opt: object) => { setCenter: (pos: LatLng) => void; setLevel: (lv: number) => void }
    LatLng: new (lat: number, lng: number) => LatLng
    Circle: new (opt: object) => Layer
    CustomOverlay: new (opt: object) => Layer
    InfoWindow: new (opt: object) => InfoBox
    event: { addListener: (target: unknown, type: string, fn: (e: { latLng: LatLng }) => void) => void }
    services?: { Status: { OK: string }; Geocoder: new () => { coord2RegionCode: (lng: number, lat: number, fn: (res: Region[], status: string) => void) => void } }
  }
}

declare global {
  interface Window { kakao?: Kakao }
}

type Status = '가능' | '불가' | '확인 필요'
type Item = { id: string; title: string; placeName: string; poster?: string; lat: number | null; lng: number | null; distance?: number; in: boolean; judge: JudgeResult }
type Spot = 'here' | 'home' | 'pick'

const BASE: Coordinate = { lat: 37.5759, lng: 126.9768 }
const RADII = [500, 1000, 2000]
const STAYS = [60, 90, 120, 180]
const ZOOM: Record<number, number> = { 500: 5, 1000: 6, 2000: 7 }
const STATUS: Record<JudgeResult['result'], Status> = { possible: '가능', impossible: '불가', unknown: '확인 필요' }
const HINT: CSSProperties = { color: '#ffffff', fontSize: 13, margin: 0 }
const HEAD: CSSProperties = { alignItems: 'flex-end', display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between', marginBottom: 16 }
const PLAN: CSSProperties = { alignItems: 'center', display: 'inline-flex', flexWrap: 'nowrap', gap: 14, marginTop: 14, maxWidth: '100%' }
const PICK: CSSProperties = { appearance: 'none', background: 'transparent', border: 0, borderBottom: '2px solid currentColor', borderRadius: 0, color: '#ffffff', cursor: 'pointer', flex: '0 0 auto', fontFamily: 'inherit', fontSize: 'clamp(16px, 2vw, 22px)', fontWeight: 850, letterSpacing: '-0.075em', lineHeight: 1.2, minHeight: 0, padding: '2px 0', width: 'auto' }

// 서울 현재 날짜/시각 반환
function NOW() {
  const now = new Date()
  return { date: todayInSeoul(now), time: now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }) }
}

// 종료 시각 계산
function END(time: string, stay: number) {
  const [h, m] = time.split(':').map(Number)
  const total = Math.min((Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0) + stay, 23 * 60 + 59)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// 판정 결과 화면용 항목
function ITEM({ entry, result }: JudgedEntry, pos: Coordinate | null, dist: number | null, inside: boolean): Item {
  const { exhibition } = entry
  return { id: exhibition.id, title: exhibition.title, placeName: displayVenueName(entry) || '장소 미상', poster: exhibition.imageUrl || undefined, lat: pos?.lat ?? null, lng: pos?.lng ?? null, distance: dist ?? undefined, in: inside, judge: result }
}

// 판정 결과 안내 문구
function LINE(res: JudgeResult, time: string): string {
  const basis = basisLabel(res.basis)
  const tail = basis ? ` · ${basis}` : ''
  if (res.result !== 'possible') return `${res.reasons[0] ?? ''}${tail}`
  const entry = res.entryTime && res.entryTime > time ? `${res.entryTime} 입장 가능` : '관람 가능합니다.'
  return `${res.lastEntryAssumed ? `${entry} (입장 마감 정보 없음)` : entry}${tail}`
}

// 동일 좌표 or 장소별 전시 묶음
function GROUP(list: Item[]) {
  return Object.values(list.reduce<Record<string, Item[]>>((acc, ex) => {
    const key = ex.lat == null || ex.lng == null ? ex.placeName : `${ex.lat},${ex.lng}`
    ;(acc[key] ||= []).push(ex)
    return acc
  }, {}))
}

// 지도 핀 상태 판별
function PIN(items: Item[]) {
  const inside = items.filter((x) => x.in)
  if (!inside.length) return 'out'
  const best = inside.find((x) => x.judge.result === 'possible') ?? inside.find((x) => x.judge.result === 'unknown') ?? inside[0]
  return best.judge.result
}

// 문자열 기반 고정 난수 생성
function SEED(text: string, salt: number) {
  let h = salt
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) % 9973
  return h / 9973
}

// 위치 미상 장소 좌표 배치
function SCATTER(key: string): CSSProperties {
  return { left: `${8 + SEED(key, 7) * 84}%`, top: `${16 + SEED(key, 13) * 76}%` }
}

// 법정동 이름 조회
function DONG(pos: Coordinate, fallback: string, done: (name: string) => void) {
  const svc = window.kakao?.maps?.services
  if (!svc) { done(fallback); return }
  new svc.Geocoder().coord2RegionCode(pos.lng, pos.lat, (res, status) => {
    const found = status === svc.Status.OK ? res.find((r) => r.region_type === 'B') : null
    done(found ? `${found.region_2depth_name} ${found.region_3depth_name}` : fallback)
  })
}

// 선택 상태별 칩 스타일 반환
function LOOK(on: boolean): CSSProperties {
  return on ? { backgroundColor: '#d8ff3e', color: '#111111', fontWeight: 800, boxShadow: '0 0 0 2px #111111', transform: 'translateY(-1px)' } : { backgroundColor: '#ffffff', color: '#111111' }
}

// 선택 가능 칩 버튼
function CHIP({ on, run, children }: { on: boolean; run: () => void; children: ReactNode }) {
  return <button type="button" className={on ? 'chip chosen' : 'chip'} style={LOOK(on)} aria-pressed={on} onClick={run}>{children}</button>
}

// 장소별 전시 말풍선 생성
function INFO({ items, pick }: { items: Item[]; pick: (item: Item) => void }) {
  return (
    <div className="info-box">
      <strong>{items[0].placeName}</strong>
      {items.map((item) => (
        <button key={item.id} type="button" className="info-row" onClick={() => pick(item)}>
          <span className={item.in ? `badge ${item.judge.result}` : 'badge out'}>{item.in ? STATUS[item.judge.result] : '반경 밖'}</span>
          <span>{item.title}</span>
        </button>
      ))}
    </div>
  )
}

// 지도 반경 및 핀 표시
function MARK(map: InstanceType<Kakao['maps']['Map']>, center: Coordinate, radius: number, spots: Item[][], go: (item: Item) => void) {
  const sdk = window.kakao?.maps
  if (!sdk) return () => {}
  const layers: Layer[] = []
  const pos = new sdk.LatLng(center.lat, center.lng)
  const dot = document.createElement('div')
  dot.className = 'center-dot'

  map.setCenter(pos)
  map.setLevel(ZOOM[radius] ?? 6)
  layers.push(new sdk.Circle({ center: pos, radius, strokeWeight: 2, strokeColor: '#111111', strokeOpacity: 0.8, fillColor: '#d8ff3e', fillOpacity: 0.18, map }))
  layers.push(new sdk.CustomOverlay({ position: pos, content: dot, zIndex: 10, map }))

  const info = new sdk.InfoWindow({ removable: true })
  const host = document.createElement('div')
  const root = createRoot(host)
  let openId: string | null = null

  spots.forEach((items) => {
    const state = PIN(items)
    const position = new sdk.LatLng(items[0].lat!, items[0].lng!)
    const pin = document.createElement('div')
    pin.className = `pin ${state}`
    if (items.length > 1) pin.textContent = String(items.length)

    layers.push(new sdk.CustomOverlay({ position, content: pin, yAnchor: 0.5, clickable: true, zIndex: state === 'out' ? 2 : 5, map }))
    ;['mousedown', 'touchstart'].forEach((t) => pin.addEventListener(t, (e) => e.stopPropagation()))

    const spotId = items[0].id
    pin.addEventListener('click', (e) => {
      e.stopPropagation()
      if (openId === spotId) { info.close(); openId = null; return }
      flushSync(() => root.render(<INFO items={items} pick={go} />))
      info.setContent(host)
      info.setPosition(position)
      info.open(map)
      openId = spotId
    })
  })

  return () => { info.close(); layers.forEach((o) => o.setMap(null)); queueMicrotask(() => root.unmount()) }
}

function NearbyExhibitions() {
  const boxRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<InstanceType<Kakao['maps']['Map']> | null>(null)
  const init = useMemo(() => NOW(), [])
  const catalog = useMemo(() => getCatalog(), [])
  const holidays = useMemo(() => getHolidays(), [])

  const [ready, setReady] = useState(false)
  const [fail] = useState(() => !window.kakao?.maps)
  const [center, setCenter] = useState<Coordinate>(BASE)
  const [label, setLabel] = useState('종로구 세종로')
  const [radius, setRadius] = useState(1000)
  const [spot, setSpot] = useState<Spot>('home')
  const [blind, setBlind] = useState(false)
  const [pop, setPop] = useState<string | null>(null)
  const [date, setDate] = useState(init.date)
  const [time, setTime] = useState(init.time)
  const [stay, setStay] = useState(60)

  const go = useCallback((item: Item) => OPEN(item.id, item.judge), [])

  const judged = useMemo(() => {
    const active = catalog.filter(({ exhibition }) => exhibition.start <= date && date <= exhibition.end)
    return judgeCatalog(active, { date, stayStart: time, stayEnd: END(time, stay) }, holidays).map((j) => {
      const loc = displayLocation(j.entry)
      return { j, pos: loc && loc.lat !== 0 && loc.lng !== 0 ? loc : null }
    })
  }, [catalog, holidays, date, time, stay])

  const all = useMemo(() => rankExhibitions(judged.filter((r): r is { j: JudgedEntry; pos: Coordinate } => r.pos !== null).map(({ j, pos }) => {
    const dist = calculateDistance(center, pos)
    return ITEM(j, pos, dist, dist <= radius)
  })), [judged, center, radius])

  const lost = useMemo(() => rankExhibitions(judged.filter((r) => r.pos === null).map(({ j }) => ITEM(j, null, null, true))), [judged])
  const near = useMemo(() => all.filter((ex) => ex.in), [all])
  const spots = useMemo(() => GROUP(all), [all])
  const lostSpots = useMemo(() => GROUP(lost), [lost])
  const list = blind ? lost : near

  const MOVE = useCallback((next: Coordinate, fallback: string, at: Spot) => {
    setBlind(false)
    setSpot(at)
    setCenter(next)
    DONG(next, fallback, setLabel)
  }, [])

  // 현재 위치 조회 및 기준 이동
  function LOCATE() {
    if (!navigator.geolocation) { alert('이 브라우저에서는 현재 위치를 쓸 수 없습니다.'); return }
    navigator.geolocation.getCurrentPosition((pos) => MOVE({ lat: pos.coords.latitude, lng: pos.coords.longitude }, '현재 위치', 'here'), () => alert('위치 권한이 거부되었습니다.'))
  }

  useEffect(() => {
    const sdk = window.kakao?.maps
    if (fail || !sdk) return
    sdk.load(() => {
      if (mapRef.current || !boxRef.current) return
      const map = new sdk.Map(boxRef.current, { center: new sdk.LatLng(BASE.lat, BASE.lng), level: 6, disableDoubleClickZoom: true })
      sdk.event.addListener(map, 'dblclick', (e) => MOVE({ lat: e.latLng.getLat(), lng: e.latLng.getLng() }, '선택한 위치', 'pick'))
      mapRef.current = map
      setReady(true)
    })
  }, [fail, MOVE])

  useEffect(() => {
    if (!mapRef.current) return
    return MARK(mapRef.current, center, radius, spots, go)
  }, [ready, center, radius, spots, go])

  return (
    <section className="nearby">
      <div className="nearby-head" style={HEAD}>
        <div>
          <h1>{blind ? '위치 정보 없음' : label}</h1>
          <p className="hint" style={HINT}>{blind ? '위치를 알 수 없는 전시입니다.' : '지도를 두 번 눌러 위치를 변경하십시오.'}</p>
        </div>
      </div>

      <div className="map-box">
        <div ref={boxRef} className="map" />
        {fail && <p className="map-error">지도를 불러오지 못했습니다.</p>}

        {blind && (
          <div className="lost-area" onClick={() => setPop(null)}>
            {lostSpots.map((items) => {
              const key = items[0].placeName
              return (
                <div key={key} className="lost-spot" style={{ ...SCATTER(key), zIndex: pop === key ? 10 : 1 }}>
                  <div className={`pin ${PIN(items)}`} onClick={(e) => { e.stopPropagation(); setPop(pop === key ? null : key) }}>{items.length > 1 ? items.length : null}</div>
                  {pop === key && <div className="lost-pop" onClick={(e) => e.stopPropagation()}><INFO items={items} pick={go} /></div>}
                </div>
              )
            })}
            <p className="lost-title">위치 없는 전시 {lost.length}건</p>
          </div>
        )}

        <div className="map-controls">
          <CHIP on={!blind && spot === 'here'} run={LOCATE}>현재 위치</CHIP>
          <CHIP on={!blind && spot === 'home'} run={() => MOVE(BASE, '종로구 세종로', 'home')}>광화문</CHIP>
          {RADII.map((r) => (
            <CHIP key={r} on={!blind && r === radius} run={() => { setBlind(false); setRadius(r) }}>{r < 1000 ? `${r}m` : `${r / 1000}km`}</CHIP>
          ))}
          <CHIP on={blind} run={() => setBlind(true)}>위치 없는 전시 {lost.length}건</CHIP>
        </div>
      </div>

      <div className="nearby-plan" style={PLAN}>
        <input type="date" aria-label="방문 날짜" className="plan-pick" style={PICK} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <input type="time" aria-label="방문 시각" className="plan-pick" style={PICK} value={time} onChange={(e) => e.target.value && setTime(e.target.value)} />
        <select aria-label="머물 시간" className="plan-pick" style={PICK} value={stay} onChange={(e) => setStay(Number(e.target.value))}>
          {STAYS.map((m) => <option key={m} value={m}>{m}분</option>)}
        </select>
      </div>

      <div className="filter-row nearby-count">
        <span className="count">전시 {list.length}건</span>
      </div>

      {list.length ? (
        <div className="card-grid">
          {list.map((ex) => (
            <OneExhibit key={ex.id} id={ex.id} judge={ex.judge} title={ex.title} venue={ex.placeName} status={STATUS[ex.judge.result]} poster={ex.poster} lines={[ex.distance == null ? '위치 정보 없음' : `${ex.distance}m`, LINE(ex.judge, time)]} />
          ))}
        </div>
      ) : (
        <p className="empty-result">선택한 조건으로 볼 수 있는 전시가 없습니다.</p>
      )}
    </section>
  )
}

export default NearbyExhibitions