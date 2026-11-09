import { useEffect, useState } from 'react'
import { seedRecords, type ArchiveEntry, type Category } from './exhibits'

const RECORDS_KEY = 'onjeonsi:archive:records'
const INTERESTS_KEY = 'onjeonsi:archive:interests'

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function useArchive() {
  const [records, setRecords] = useState<ArchiveEntry[]>(() => read(RECORDS_KEY, seedRecords))
  const [interests, setInterests] = useState<Category[]>(() => read(INTERESTS_KEY, []))

  useEffect(() => {
    try {
      localStorage.setItem(RECORDS_KEY, JSON.stringify(records))
    } catch {
      return
    }
  }, [records])

  useEffect(() => {
    try {
      localStorage.setItem(INTERESTS_KEY, JSON.stringify(interests))
    } catch {
      return
    }
  }, [interests])

  return { records, setRecords, interests, setInterests }
}