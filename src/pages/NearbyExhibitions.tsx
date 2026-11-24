import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { calculateDistance, type Coordinate } from '../engine/distance'
import { rankExhibitions } from '../engine/sort'
import { readVisitedIds } from '../lib/archive'
import { basisLabel, displayLocation, displayVenueName, getCatalog, getHolidays, judgeCatalog, todayInSeoul, type CatalogQuery, type JudgedEntry } from '../lib/catalog'
import type { JudgeResult } from '../types'
import OneExhibit, { OPEN } from '../components/OneExhibit'
import './NearbyExhibitions.css'

interface LatLng { getLat: () => number; getLng: () => number }
interface Layer { setMap: (map: unknown) => void }
interface Region { region_type: string; region_2depth_name: string; region_3depth_name: string }
interface Kakao {
  maps: {
    load: (fn: () => void) => void
    Map: new (el: HTMLElement, opt: object) => { setCenter: (pos: LatLng) => void; setLevel: (lv: number) => void }
    LatLng: new (lat: number, lng: number) => LatLng
    Circle: new (opt: object) => Layer
    CustomOverlay: new (opt: object) => Layer
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
type Merit = 'AM' | 'PM'
type Opt<T> = { value: T; label: string }
type Group = { key: string; items: Item[] }
type Time = { ap: Merit; h12: number; min: number }

const BASE: Coordinate = { lat: 37.5759, lng: 126.9768 }
const RADII = [500, 1000, 2000]
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)
const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const MINUTES = [0, 10, 20, 30, 40, 50]
const MERITS: Opt<Merit>[] = [{ value: 'AM', label: '오전' }, { value: 'PM', label: '오후' }]
const ZOOM: Record<number, number> = { 500: 5, 1000: 6, 2000: 7 }
const STATUS: Record<JudgeResult['result'], Status> = { possible: '가능', impossible: '불가', unknown: '확인 필요' }
const LEGEND = [{ cls: 'possible', label: '가능' }, { cls: 'unknown', label: '확인 필요' }, { cls: 'impossible', label: '불가' }, { cls: 'out', label: '반경 밖' }]

// 오전/오후 및 시/분 분리
function SPLIT(total: number): Time {
  const clamped = Math.min(Math.max(0, total), 23 * 60 + 50)
  const hh = Math.floor(clamped / 60)
  const min = Math.floor((clamped % 60) / 10) * 10
  return { ap: hh >= 12 ? 'PM' : 'AM', h12: hh % 12 === 0 ? 12 : hh % 12, min }
}

// 서울 현재 날짜 및 초기 시작/종료 시각 반환
function NOW() {
  const now = new Date()
  const date = todayInSeoul(now)
  const [y, m, d] = date.split('-').map(Number)
  const raw = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' })
  const [hh, mm] = raw.split(':').map(Number)
  const startTotal = hh * 60 + Math.floor(mm / 10) * 10
  return { y, m, d, start: SPLIT(startTotal), end: SPLIT(startTotal + 120) }
}

// 연/월 기준 일 수
function DAYS(y: number, m: number) {
  const last = new Date(y, m, 0).getDate()
  return Array.from({ length: last }, (_, i) => i + 1)
}

// 두 자리 숫자 문자열 변환
function PAD(n: number) {
  return String(n).padStart(2, '0')
}

// 순환 index 계산
function LOOP(len: number, idx: number, diff: number) {
  return (idx + diff + len) % len
}

// 오전/오후 및 24시간 변환
function CLOCK(ap: Merit, h12: number, min: number) {
  const base = h12 % 12
  const hh = ap === 'PM' ? base + 12 : base
  return `${PAD(hh)}:${PAD(min)}`
}

// 아카이브 기록 전시 ID 집합 조회
function CONQUERED(): Set<string> {
  return readVisitedIds()
}

// 판정 결과 화면용 항목
function ITEM({ entry, result }: JudgedEntry, pos: Coordinate | null, dist: number | null, inside: boolean): Item {
  const { exhibition } = entry
  return { id: exhibition.id, title: exhibition.title, placeName: displayVenueName(entry) || '장소 미상', poster: exhibition.imageUrl || undefined, lat: pos?.lat ?? null, lng: pos?.lng ?? null, distance: dist ?? undefined, in: inside, judge: result }
}

// 판정 결과 안내
function LINE(res: JudgeResult, time: string): string {
  const basis = basisLabel(res.basis)
  const tail = basis ? ` · ${basis}` : ''
  if (res.result !== 'possible') return `${res.reasons[0] ?? ''}${tail}`
  const entry = res.entryTime && res.entryTime > time ? `${res.entryTime} 입장 가능` : '관람 가능합니다.'
  return `${res.lastEntryAssumed ? `${entry} (입장 마감 정보 없음)` : entry}${tail}`
}

// 동일 좌표 기준 전시 묶음
function GROUP(list: Item[]): Group[] {
  const map = list.reduce<Record<string, Item[]>>((acc, ex) => {
    const key = ex.lat == null || ex.lng == null ? ex.placeName : `${ex.lat},${ex.lng}`
    ;(acc[key] ||= []).push(ex)
    return acc
  }, {})
  return Object.entries(map).map(([key, items]) => ({ key, items }))
}

// 지도 핀 대표 상태
function PIN(items: Item[]) {
  const inside = items.filter((x) => x.in)
  if (!inside.length) return 'out'
  const best = inside.find((x) => x.judge.result === 'possible') ?? inside.find((x) => x.judge.result === 'unknown') ?? inside[0]
  return best.judge.result
}

// 법정동 이름
function DONG(pos: Coordinate, fallback: string, done: (name: string) => void) {
  const svc = window.kakao?.maps?.services
  if (!svc) { done(fallback); return }
  new svc.Geocoder().coord2RegionCode(pos.lng, pos.lat, (res, status) => {
    const found = status === svc.Status.OK ? res.find((r) => r.region_type === 'B') : null
    done(found ? `${found.region_2depth_name} ${found.region_3depth_name}` : fallback)
  })
}

// 선택 상태별 칩 스타일
function LOOK(on: boolean): CSSProperties {
  return on ? { backgroundColor: '#111111', borderColor: '#111111', color: '#ffffff', fontWeight: 800, boxShadow: '0 2px 6px rgba(0, 0, 0, 0.14)', transform: 'translateY(-1px)' } : { backgroundColor: '#ffffff', borderColor: '#111111', color: '#111111', fontWeight: 700 }
}

// 선택 가능 칩 버튼
function CHIP({ on, run, children }: { on: boolean; run: () => void; children: ReactNode }) {
  return <button type="button" className={on ? 'chip chosen' : 'chip'} style={LOOK(on)} aria-pressed={on} onClick={run}>{children}</button>
}

// 화살표 조절 선택 상자
function STEP<T extends string | number>({ name, value, list, set }: { name: string; value: T; list: Opt<T>[]; set: (next: T) => void }) {
  const idx = Math.max(0, list.findIndex((o) => o.value === value))
  const move = (diff: number) => set(list[LOOP(list.length, idx, diff)].value)
  return (
    <span className="step-box">
      <select aria-label={name} value={String(value)} onChange={(e) => { const hit = list.find((o) => String(o.value) === e.target.value); if (hit) set(hit.value) }}>
        {list.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
      <span className="step-arrows">
        <button type="button" aria-label={`${name} 증가`} onClick={() => move(1)}>▲</button>
        <button type="button" aria-label={`${name} 감소`} onClick={() => move(-1)}>▼</button>
      </span>
    </span>
  )
}

// 전시 카드 및 관람 오버레이
function CARD({ ex, cond, time, done }: { ex: Item; cond: CatalogQuery; time: string; done: boolean }) {
  return (
    <div className={done ? 'card-slot conquered-card' : 'card-slot'}>
      <OneExhibit id={ex.id} judge={ex.judge} cond={cond} title={ex.title} venue={ex.placeName} status={STATUS[ex.judge.result]} poster={ex.poster} lines={[ex.distance == null ? '위치 정보 없음' : `${ex.distance}m`, LINE(ex.judge, time)]} />
      {done && (
        <div className="conquered-veil" aria-label="정복 완료">
          <span className="conquered-stamp">관람</span>
        </div>
      )}
    </div>
  )
}

// 지도 오른쪽 장소 상세 패널
function PANEL({ group, pick }: { group: Group | null; pick: (item: Item) => void }) {
  if (!group) {
    return (
      <aside className="map-panel" aria-label="선택한 장소 전시 목록">
        <p className="map-panel-empty">지도에서 원을 누르세요.<br />해당 위치의 전시 목록이 표시됩니다.</p>
      </aside>
    )
  }
  const { items } = group
  return (
    <aside className="map-panel" aria-label="선택한 장소 전시 목록">
      <div className="map-panel-head">
        <strong>{items[0].placeName}</strong>
        <span>{items.length}건</span>
      </div>
      <div className="map-panel-list">
        {items.map((item) => (
          <button key={item.id} type="button" className="map-panel-row" onClick={() => pick(item)}>
            <div className="map-panel-row-top">
              <span className={item.in ? `badge ${item.judge.result}` : 'badge out'}>{item.in ? STATUS[item.judge.result] : '반경 밖'}</span>
              <span>{item.distance == null ? '' : `${item.distance}m`}</span>
            </div>
            <span className="map-panel-title">{item.title}</span>
          </button>
        ))}
      </div>
    </aside>
  )
}

// 지도 반경 동그라미 및 시설 동그라미 배치
function MARK(map: InstanceType<Kakao['maps']['Map']>, center: Coordinate, radius: number, spots: Group[], activeKey: string | null, pickSpot: (key: string | null) => void) {
  const sdk = window.kakao?.maps
  if (!sdk) return () => {}
  const layers: Layer[] = []
  const pos = new sdk.LatLng(center.lat, center.lng)
  const dot = document.createElement('div')
  dot.className = 'center-dot'

  map.setCenter(pos)
  map.setLevel(ZOOM[radius] ?? 6)
  layers.push(new sdk.Circle({ center: pos, radius, strokeWeight: 2, strokeColor: '#111111', strokeOpacity: 0.85, fillColor: '#d5ff36', fillOpacity: 0.25, map }))
  layers.push(new sdk.CustomOverlay({ position: pos, content: dot, zIndex: 10, map }))

  spots.forEach(({ key, items }) => {
    const state = PIN(items)
    const active = activeKey === key
    const position = new sdk.LatLng(items[0].lat!, items[0].lng!)
    const pin = document.createElement('div')
    pin.className = `pin ${state}${active ? ' active' : ''}`
    pin.textContent = String(items.length)

    layers.push(new sdk.CustomOverlay({ position, content: pin, yAnchor: 0.5, clickable: true, zIndex: active ? 20 : state === 'out' ? 2 : 5, map }))
    ;['mousedown', 'touchstart'].forEach((t) => pin.addEventListener(t, (e) => e.stopPropagation()))
    pin.addEventListener('click', (e) => {
      e.stopPropagation()
      pickSpot(activeKey === key ? null : key)
    })
  })

  return () => { layers.forEach((o) => o.setMap(null)) }
}

function NearbyExhibitions() {
  const boxRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<InstanceType<Kakao['maps']['Map']> | null>(null)
  const init = useMemo(() => NOW(), [])
  const catalog = useMemo(() => getCatalog(), [])
  const holidays = useMemo(() => getHolidays(), [])
  const done = useMemo(() => CONQUERED(), [])

  const [ready, setReady] = useState(false)
  const [fail] = useState(() => !window.kakao?.maps)
  const [center, setCenter] = useState<Coordinate>(BASE)
  const [label, setLabel] = useState('종로구 세종로')
  const [radius, setRadius] = useState(1000)
  const [spot, setSpot] = useState<Spot>('home')
  const [pickedKey, setPickedKey] = useState<string | null>(null)
  const [year, setYear] = useState(init.y)
  const [month, setMonth] = useState(init.m)
  const [day, setDay] = useState(init.d)
  const [startMerit, setStartMerit] = useState<Merit>(init.start.ap)
  const [startHour, setStartHour] = useState(init.start.h12)
  const [startMinute, setStartMinute] = useState(init.start.min)
  const [endMerit, setEndMerit] = useState<Merit>(init.end.ap)
  const [endHour, setEndHour] = useState(init.end.h12)
  const [endMinute, setEndMinute] = useState(init.end.min)

  const yearOpts = useMemo(() => [init.y - 1, init.y, init.y + 1].map((y) => ({ value: y, label: String(y) })), [init.y])
  const monthOpts = useMemo(() => MONTHS.map((m) => ({ value: m, label: String(m) })), [])
  const dayList = useMemo(() => DAYS(year, month), [year, month])
  const dayOpts = useMemo(() => dayList.map((d) => ({ value: d, label: String(d) })), [dayList])
  const hourOpts = useMemo(() => HOURS.map((h) => ({ value: h, label: String(h) })), [])
  const minOpts = useMemo(() => MINUTES.map((m) => ({ value: m, label: PAD(m) })), [])

  const safeDay = Math.min(day, dayList.length)
  const date = useMemo(() => `${year}-${PAD(month)}-${PAD(safeDay)}`, [year, month, safeDay])
  const stayStart = useMemo(() => CLOCK(startMerit, startHour, startMinute), [startMerit, startHour, startMinute])
  const stayEnd = useMemo(() => CLOCK(endMerit, endHour, endMinute), [endMerit, endHour, endMinute])
  const invalidTime = stayEnd <= stayStart

  const cond = useMemo<CatalogQuery>(() => ({ date, stayStart, stayEnd }), [date, stayStart, stayEnd])
  const go = useCallback((item: Item) => OPEN(item.id, item.judge, cond), [cond])

  const judged = useMemo(() => {
    const active = catalog.filter(({ exhibition }) => exhibition.start <= date && date <= exhibition.end)
    return judgeCatalog(active, cond, holidays).map((j) => {
      const loc = displayLocation(j.entry)
      return { j, pos: loc && loc.lat !== 0 && loc.lng !== 0 ? loc : null }
    })
  }, [catalog, holidays, date, cond])

  const all = useMemo(() => rankExhibitions(judged.filter((r): r is { j: JudgedEntry; pos: Coordinate } => r.pos !== null).map(({ j, pos }) => {
    const dist = calculateDistance(center, pos)
    return ITEM(j, pos, dist, dist <= radius)
  })), [judged, center, radius])

  const near = useMemo(() => all.filter((ex) => ex.in), [all])
  const spots = useMemo(() => GROUP(all), [all])
  const picked = useMemo(() => spots.find((s) => s.key === pickedKey) ?? null, [spots, pickedKey])

  const MOVE = useCallback((next: Coordinate, fallback: string, at: Spot) => {
    setSpot(at)
    setCenter(next)
    setPickedKey(null)
    DONG(next, fallback, setLabel)
  }, [])

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
    return MARK(mapRef.current, center, radius, spots, pickedKey, setPickedKey)
  }, [ready, center, radius, spots, pickedKey])

  return (
    <section className="nearby">
      <div className="nearby-head">
        <div className="nearby-plan">
          <div className="nearby-plan-row">
            <span className="nearby-plan-label">전시 볼 날짜</span>
            <div className="nearby-plan-fields">
              <STEP name="방문 연도" value={year} list={yearOpts} set={setYear} />
              <span>년</span>
              <STEP name="방문 월" value={month} list={monthOpts} set={setMonth} />
              <span>월</span>
              <STEP name="방문 일" value={safeDay} list={dayOpts} set={setDay} />
              <span>일</span>
            </div>
          </div>

          <div className="nearby-plan-row">
            <span className="nearby-plan-label">가능한 시간</span>
            <div className="nearby-plan-fields">
              <STEP name="시작 오전 오후" value={startMerit} list={MERITS} set={setStartMerit} />
              <STEP name="시작 시" value={startHour} list={hourOpts} set={setStartHour} />
              <span>시</span>
              <STEP name="시작 분" value={startMinute} list={minOpts} set={setStartMinute} />
              <span>분부터</span>
              <STEP name="종료 오전 오후" value={endMerit} list={MERITS} set={setEndMerit} />
              <STEP name="종료 시" value={endHour} list={hourOpts} set={setEndHour} />
              <span>시</span>
              <STEP name="종료 분" value={endMinute} list={minOpts} set={setEndMinute} />
              <span>분까지</span>
            </div>
            {invalidTime && <p className="time-warning" role="alert" style={{ color: '#c4372b', fontSize: 12, fontWeight: 700, margin: '6px 0 0', width: '100%' }}>종료 시각은 시작보다 늦어야 합니다.</p>}
          </div>
        </div>

        <div className="nearby-place">
          <h1>{label}</h1>
          <p className="hint">지도를 두 번 눌러 위치를 변경하십시오.</p>
        </div>
      </div>

      <div className="map-stage">
        <div className="map-box">
          <div ref={boxRef} className="map" />
          {fail && <p className="map-error">지도를 불러오지 못했습니다.</p>}

          <div className="map-controls">
            <CHIP on={spot === 'here'} run={LOCATE}>현재 위치</CHIP>
            {RADII.map((r) => (
              <CHIP key={r} on={r === radius} run={() => setRadius(r)}>{r < 1000 ? `${r}m` : `${r / 1000}km`}</CHIP>
            ))}
            <div className="map-legend" aria-label="핀 색상 안내">
              {LEGEND.map((l) => (
                <span key={l.cls} className="legend-item">
                  <i className={`legend-dot ${l.cls}`} />
                  {l.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <PANEL group={picked} pick={go} />
      </div>

      <div className="filter-row nearby-count">
        <span className="count">전시 {near.length}건</span>
      </div>

      {near.length ? (
        <div className="card-grid">
          {near.map((ex) => (
            <CARD key={ex.id} ex={ex} cond={cond} time={stayStart} done={done.has(ex.id)} />
          ))}
        </div>
      ) : (
        <p className="empty-result">선택한 조건으로 볼 수 있는 전시가 없습니다.</p>
      )}
    </section>
  )
}

export default NearbyExhibitions