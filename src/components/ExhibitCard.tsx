import { Link } from 'react-router-dom'
import { statusClass, type Status } from '../mock/exhibits'
import './ExhibitCard.css'

type Props = {
  to: string
  state?: unknown
  title: string
  venue: string
  status: Status
  poster?: string
  lines?: string[]
}

export default function ExhibitCard({ to, state, title, venue, status, poster, lines = [] }: Props) {
  return (
    <Link className="card" to={to} state={state}>
      <div className="poster">
        {poster ? (
          <img src={poster} alt={title} loading="lazy" decoding="async" />
        ) : (
          <div className="poster-empty">포스터 없음</div>
        )}
        <span className={`status-tag ${statusClass(status)}`}>{status}</span>
      </div>
      <strong>{title}</strong>
      <span className="card-sub">{venue}</span>
      {lines.filter(Boolean).map((line, index) => (
        <span key={index} className={index === 0 ? 'card-meta' : 'card-source'}>
          {line}
        </span>
      ))}
    </Link>
  )
}