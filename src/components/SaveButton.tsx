import { useState, useSyncExternalStore } from 'react'
import type { CatalogEntry } from '../lib/catalog'
import { savedStore } from '../lib/saved'
import './SaveButton.css'

type Props = {
  entry: CatalogEntry
  // 놓일 자리에 맞춘 추가 클래스 (overlay: 카드 포스터 위, push: 가로 줄에서 오른쪽 끝으로)
  className?: string
}

// 북마크 아이콘. filled면 속을 채운다
export function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M6 3h12v18l-6-4.5L6 21z" />
    </svg>
  )
}

// 북마크(가볼 전시) 버튼. 저장·구독은 lib/saved가 하므로 놓기만 하면 된다
export default function SaveButton({ entry, className }: Props) {
  const store = savedStore()
  const ids = useSyncExternalStore(store.subscribe, store.getIds)
  // 저장에 실패한 전시 id. 상세 창은 다른 전시로 넘어가도 이 버튼을 다시 쓰므로, 그 전시에서만 안내를 보인다
  const [failedId, setFailedId] = useState<string | null>(null)
  const id = entry.exhibition.id
  const on = ids.has(id)
  const failed = failedId === id

  return (
    <span className={className ? `save-wrap ${className}` : 'save-wrap'}>
      <button
        type="button"
        className={on ? 'save-button on' : 'save-button'}
        aria-pressed={on}
        aria-label="북마크"
        title={on ? '북마크 해제' : '북마크'}
        onClick={(e) => {
          // 카드·창 같은 바깥 요소의 클릭(상세 열기·닫기)으로 번지지 않게 한다
          e.stopPropagation()
          setFailedId(store.toggle(entry) === 'failed' ? id : null)
        }}
      >
        <BookmarkIcon filled={on} />
      </button>
      {failed && <span className="save-error" role="alert">이 브라우저에는 저장할 수 없어요</span>}
    </span>
  )
}
