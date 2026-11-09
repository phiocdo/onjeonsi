import { useState } from 'react'
import ExhibitCard from '../components/ExhibitCard'
import { exhibits, posterUrl } from '../mock/exhibits'

const AREAS = ['전체', '종로구', '중구'] as const

export default function OverviewList() {
  const [area, setArea] = useState<(typeof AREAS)[number]>('전체')
  const items = exhibits.filter((item) => area === '전체' || item.area === area)

  return (
    <section>
      <div className="filter-row">
        <div className="chips">
          {AREAS.map((name) => (
            <button
              key={name}
              className={area === name ? 'chip chosen' : 'chip'}
              onClick={() => setArea(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <span className="count">{items.length}개 전시</span>
      </div>

      <div className="card-grid">
        {items.map((item) => (
          <ExhibitCard
            key={item.id}
            to={`/overview/m${item.id}`}
            title={item.name}
            venue={item.venue}
            status={item.status}
            poster={posterUrl(item.poster)}
            lines={[item.period, `${item.source} · ${item.checked}`]}
          />
        ))}
      </div>
    </section>
  )
}