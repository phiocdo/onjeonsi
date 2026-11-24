import { useMemo, useSyncExternalStore } from 'react'
import { getCatalog, type CatalogEntry } from '../lib/catalog'
import { getCachedStats, subscribeStats } from '../lib/sharedRatings'
import { tagsOf } from '../lib/tags'
import { pickKeywords } from '../lib/userTags'

// 전시 하나의 키워드 (최대 4개). 다른 관람자들이 단 태그(서버 get_tag_stats, 2명 이상)를 먼저 '#태그'로,
// 모자라면 #71 주제 태그(제목·장소로 자동 분류)를 회색으로 채운다. 고르는 규칙은 src/lib/userTags.ts의 pickKeywords.
// 서버 태그 통계가 없거나 실패하면 주제 태그만 보이고, 둘 다 없으면 아무것도 그리지 않는다

let BY_ID: Map<string, CatalogEntry> | null = null

// 전시 id → 카탈로그 항목 (카드마다 목록을 다시 훑지 않게 한 번만 만든다)
function ENTRY(id: string): CatalogEntry | undefined {
  BY_ID ??= new Map(getCatalog().map((c) => [c.exhibition.id, c]))
  return BY_ID.get(id)
}

export default function ExhibitKeywords({ id }: { id: string }) {
  const stats = useSyncExternalStore(subscribeStats, getCachedStats)
  const topics = useMemo(() => {
    const entry = ENTRY(id)
    return entry ? tagsOf(entry) : []
  }, [id])
  const items = pickKeywords(stats.tags.get(id), topics)
  if (!items.length) return null

  return (
    <span className="one-keywords" aria-label="키워드">
      {items.map((k) =>
        k.kind === 'user' ? (
          <span key={`u:${k.tag}`} className="one-keyword user" title={`${k.users}명이 단 태그`}>#{k.tag}</span>
        ) : (
          <span key={`t:${k.tag}`} className="one-keyword topic" title="전시 주제 (제목·장소로 자동 분류)">{k.tag}</span>
        ),
      )}
    </span>
  )
}
