import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import exhibitions from '../../data/exhibitions/auto.json'
import { mockItems } from '../mock/data'
import { JUDGE_STATUS, type JudgeKey } from '../mock/exhibits'
import ExhibitCard from '../components/ExhibitCard'
import './NearbyExhibitions.css'

declare global {
  interface Window {
    kakao: any
  }
}

type Judge = { result: JudgeKey; reasons: string[] }
type SpotItem = { id: string | number; title: string; placeName: string; judge: Judge }

const GWANGHWAMUN = { lat: 37.5759, lng: 126.9768 }
const RADIUS_OPTIONS = [500, 1000, 2000]
const LEVEL_BY_RADIUS: Record<number, number> = { 500: 5, 1000: 6, 2000: 7 }

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function buildInfo(items: SpotItem[], onSelect: (item: SpotItem) => void) {
  const box = document.createElement('div')
  box.className = 'info-box'

  const name = document.createElement('strong')
  name.textContent = items[0].placeName
  box.appendChild(name)

  items.forEach((item) => {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'info-row'

    const badge = document.createElement('span')
    badge.className = `badge ${item.judge.result}`
    badge.textContent = JUDGE_STATUS[item.judge.result]

    const title = document.createElement('span')
    title.textContent = item.title

    row.append(badge, title)
    row.addEventListener('click', () => onSelect(item))
    box.appendChild(row)
  })

  return box
}

function NearbyExhibitions() {
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  const mapRef = useRef<HTMLDivElement>(null)
  const mapObj = useRef<any>(null)
  const [ready, setReady] = useState(false)
  const [failed] = useState(() => !window.kakao?.maps)
  const [center, setCenter] = useState(GWANGHWAMUN)
  const [label, setLabel] = useState('광화문')
  const [radius, setRadius] = useState(1000)

  useEffect(() => {
    navigateRef.current = navigate
  }, [navigate])

  const nearby = useMemo(() => {
    const today = new Date().toLocaleDateString('sv-SE')
    return exhibitions
      .filter(
        (ex) =>
          ex.lat &&
          ex.lng &&
          ex.start <= today &&
          today <= ex.end &&
          distanceMeters(center.lat, center.lng, ex.lat, ex.lng) <= radius
      )
      .map((ex) => ({
        ...ex,
        distance: distanceMeters(center.lat, center.lng, ex.lat!, ex.lng!),
      }))
      .sort((a, b) => a.distance - b.distance)
      .map((ex, i) => ({ ...ex, judge: mockItems[i % mockItems.length].judgeResult }))
  }, [center, radius])

  const spots = useMemo(
    () =>
      Object.values(
        nearby.reduce<Record<string, typeof nearby>>((acc, ex) => {
          const key = `${ex.lat},${ex.lng}`
          ;(acc[key] ||= []).push(ex)
          return acc
        }, {})
      ),
    [nearby]
  )

  function locateMe() {
    if (!navigator.geolocation) {
      alert('이 브라우저에서는 현재 위치를 쓸 수 없습니다.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setLabel('현재 위치')
      },
      () => alert('위치 권한이 거부되었습니다.')
    )
  }

  useEffect(() => {
    if (failed) return
    window.kakao.maps.load(() => {
      if (mapObj.current || !mapRef.current) return
      const map = new window.kakao.maps.Map(mapRef.current, {
        center: new window.kakao.maps.LatLng(GWANGHWAMUN.lat, GWANGHWAMUN.lng),
        level: 6,
        disableDoubleClickZoom: true,
      })
      window.kakao.maps.event.addListener(map, 'dblclick', (e: any) => {
        setCenter({ lat: e.latLng.getLat(), lng: e.latLng.getLng() })
        setLabel('지도에서 선택한 위치')
      })
      mapObj.current = map
      setReady(true)
    })
  }, [failed])

  useEffect(() => {
    const map = mapObj.current
    if (!map) return

    const layers: any[] = []
    const pos = new window.kakao.maps.LatLng(center.lat, center.lng)
    map.setCenter(pos)
    map.setLevel(LEVEL_BY_RADIUS[radius] ?? 6)

    layers.push(
      new window.kakao.maps.Circle({
        center: pos,
        radius,
        strokeWeight: 2,
        strokeColor: '#111111',
        strokeOpacity: 0.8,
        fillColor: '#d8ff3e',
        fillOpacity: 0.18,
        map,
      })
    )

    layers.push(
      new window.kakao.maps.CustomOverlay({
        position: pos,
        content: '<div class="center-dot"></div>',
        zIndex: 10,
        map,
      })
    )

    const info = new window.kakao.maps.InfoWindow({ removable: true })
    let openedId: string | number | null = null

    const goDetail = (item: SpotItem) => {
      navigateRef.current(`/overview/${item.id}`, { state: { judge: item.judge } })
    }

    spots.forEach((items) => {
      const best =
        items.find((x) => x.judge.result === 'possible') ??
        items.find((x) => x.judge.result === 'unknown') ??
        items[0]

      const position = new window.kakao.maps.LatLng(items[0].lat, items[0].lng)

      const pin = document.createElement('div')
      pin.className = `pin ${best.judge.result}`
      if (items.length > 1) {
        pin.textContent = String(items.length)
      }

      layers.push(
        new window.kakao.maps.CustomOverlay({
          position,
          content: pin,
          yAnchor: 1,
          clickable: true,
          map,
        })
      )

      ;['mousedown', 'touchstart'].forEach((type) =>
        pin.addEventListener(type, (e) => e.stopPropagation())
      )

      const spotId = items[0].id
      pin.addEventListener('click', (e) => {
        e.stopPropagation()
        if (openedId === spotId) {
          info.close()
          openedId = null
          return
        }
        info.setContent(buildInfo(items, goDetail))
        info.setPosition(position)
        info.open(map)
        openedId = spotId
      })
    })

    return () => {
      info.close()
      layers.forEach((o) => o.setMap(null))
    }
  }, [ready, center, radius, spots])

  return (
    <section className="nearby">
      <div className="nearby-head">
        <div>
          <h1>{label}</h1>
          <p className="hint">지도를 두 번 누르면 그 자리가 기준 위치가 돼요</p>
        </div>
        <div className="nearby-controls">
          <div className="chips">
            <button className="chip" onClick={locateMe}>
              현재 위치
            </button>
            <button
              className="chip"
              onClick={() => {
                setCenter(GWANGHWAMUN)
                setLabel('광화문')
              }}
            >
              광화문
            </button>
          </div>
          <div className="chips">
            {RADIUS_OPTIONS.map((r) => (
              <button
                key={r}
                className={r === radius ? 'chip chosen' : 'chip'}
                onClick={() => setRadius(r)}
              >
                {r < 1000 ? `${r}m` : `${r / 1000}km`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="map-box">
        <div ref={mapRef} className="map" />
        {failed && (
          <p className="map-error">
            지도를 불러오지 못했어요. .env의 카카오맵 키를 확인하고 서버를 다시 켜 주세요.
          </p>
        )}
      </div>

      <div className="filter-row nearby-count">
        <span className="count">전시 {nearby.length}건</span>
      </div>

      {nearby.length ? (
        <div className="card-grid">
          {nearby.map((ex) => (
            <ExhibitCard
              key={ex.id}
              to={`/overview/${ex.id}`}
              state={{ judge: ex.judge }}
              title={ex.title}
              venue={ex.placeName}
              status={JUDGE_STATUS[ex.judge.result]}
              lines={[`${Math.round(ex.distance)}m`, ex.judge.reasons[0] ?? '']}
            />
          ))}
        </div>
      ) : (
        <p className="empty-result">이 범위에 오늘 볼 수 있는 전시가 없어요.</p>
      )}
    </section>
  )
}

export default NearbyExhibitions