import { useId, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { MAX_TAG_LENGTH, MAX_TAGS, SUGGESTED_TAGS, normalizeTag, normalizeTags } from '../lib/userTags'

// 관람 기록의 사용자 태그 입력 (src/lib/userTags.ts). #71의 주제 태그(src/lib/tags.ts)와 다르다.
// 스타일은 전역 .chips/.chip을 쓰고, 이 컴포넌트에만 필요한 배치만 아래에 둔다
const BOX: CSSProperties = { display: 'grid', gap: 8, marginBottom: 16 }
const ROW: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center' }
const HEAD: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, fontWeight: 700 }
const NOTE: CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--muted)' }

type Props = { value: readonly string[]; onChange: (next: string[]) => void }

export default function TagInput({ value, onChange }: Props) {
  const [draft, setDraft] = useState('')
  const [hint, setHint] = useState('')
  const inputId = useId()
  const full = value.length >= MAX_TAGS

  // 입력한 조각들을 정리해 더한다. 못 넣은 이유는 안내 문구로 보여 준다
  function ADD(parts: string[]) {
    const raw = parts.map((p) => p.trim()).filter(Boolean)
    if (!raw.length) return
    const valid = raw.map(normalizeTag).filter((t): t is string => t !== null)
    const next = normalizeTags([...value, ...valid])
    if (valid.length < raw.length) setHint(`태그는 한글·영문·숫자로 1~${MAX_TAG_LENGTH}자까지 쓸 수 있습니다.`)
    else if (valid.some((t) => !next.includes(t))) setHint(`태그는 ${MAX_TAGS}개까지 달 수 있습니다.`)
    else setHint('')
    if (next.length !== value.length) onChange(next)
  }

  function REMOVE(tag: string) {
    setHint('')
    onChange(value.filter((t) => t !== tag))
  }

  // 추천 칩: 있으면 빼고 없으면 더한다
  function TOGGLE(tag: string) {
    if (value.includes(tag)) REMOVE(tag)
    else ADD([tag])
  }

  // 쉼표가 들어오면(직접 입력·붙여넣기) 앞부분을 태그로 더하고 마지막 조각만 칸에 남긴다
  function TYPE(text: string) {
    if (!text.includes(',')) {
      setDraft(text)
      return
    }
    const parts = text.split(',')
    const rest = parts.pop() ?? ''
    ADD(parts)
    setDraft(rest)
  }

  function KEY(e: KeyboardEvent<HTMLInputElement>) {
    // 한글 조합 중 Enter는 조합을 끝내는 키라 태그로 넣지 않는다 (마지막 글자가 따로 들어가는 것을 막음)
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key !== 'Enter') return
    e.preventDefault()
    COMMIT()
  }

  function COMMIT() {
    ADD([draft])
    setDraft('')
  }

  return (
    <div style={BOX}>
      <div style={HEAD}>
        <label htmlFor={inputId}>내 태그 (선택)</label>
        <span aria-live="polite">{value.length}/{MAX_TAGS}</span>
      </div>

      {value.length > 0 && (
        <div className="chips" aria-label="단 태그">
          {value.map((tag) => (
            <button key={tag} type="button" className="chip chosen" aria-label={`태그 ${tag} 지우기`} onClick={() => REMOVE(tag)}>
              #{tag} ✕
            </button>
          ))}
        </div>
      )}

      <div style={ROW}>
        <input
          id={inputId}
          type="text"
          value={draft}
          disabled={full}
          maxLength={40}
          placeholder={full ? `태그는 ${MAX_TAGS}개까지 달 수 있습니다` : '직접 입력 후 Enter 또는 쉼표'}
          onChange={(e) => TYPE(e.target.value)}
          onKeyDown={KEY}
          // 입력만 하고 Enter 없이 저장 버튼을 눌러도 잃지 않게 칸을 떠날 때 넣는다
          onBlur={() => { if (draft.trim()) COMMIT() }}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button type="button" className="chip" disabled={full || !draft.trim()} onClick={COMMIT}>추가</button>
      </div>

      <div className="chips" aria-label="추천 태그">
        {SUGGESTED_TAGS.map((tag) => {
          const on = value.includes(tag)
          return (
            <button key={tag} type="button" className={on ? 'chip chosen' : 'chip'} aria-pressed={on} disabled={!on && full} onClick={() => TOGGLE(tag)}>
              {tag}
            </button>
          )
        })}
      </div>

      {hint && <p style={NOTE} role="status">{hint}</p>}
      <p style={NOTE}>공유에 동의하면 태그가 익명으로 공개됩니다. 메모는 공유하지 않습니다.</p>
    </div>
  )
}

// 기록 항목에 작게 보이는 내 태그
export function TagList({ tags }: { tags?: readonly string[] }) {
  if (!tags?.length) return null
  return <p className="record-note" aria-label="내 태그" style={{ color: 'var(--muted)' }}>{tags.map((t) => `#${t}`).join(' ')}</p>
}
