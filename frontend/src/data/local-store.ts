import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// 版本号随种子结构升级：旧版本数据直接作废重播，避免历史持久化记录遮蔽新种子（列表显示成旧记录的根因）。
const STORAGE_KEY = 'underground-pipeline-inspection:entries:v2'

type StoreChangeReason = 'save' | 'reset' | 'cross-tab'
type StoreChangeListener = (reason: StoreChangeReason, key?: string) => void

const listeners = new Set<StoreChangeListener>()

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 数据读取失败：页面需要把它与「查无数据（空结果）」区分开。 */
export class DataReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DataReadError'
  }
}

function seedAll(): Record<string, EntryRow[]> {
  return clone(SEED_ROWS)
}

/**
 * 严格读取：存储损坏 / 结构不对时抛 DataReadError，交给页面提示并提供恢复入口，
 * 不再静默回退到种子数据（静默回退会让「读取失败」伪装成「正常数据」）。
 */
function readStorageStrict(): Record<string, EntryRow[]> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return seedAll()
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seeded = seedAll()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new DataReadError('本地应急数据已损坏，无法解析，请重试或恢复为示例数据')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new DataReadError('本地应急数据结构不正确，请重试或恢复为示例数据')
  }
  // 以种子模块为基准做形状校验；未知模块丢弃，缺模块用种子补齐，绝不拿旧结构硬凑。
  const record = parsed as Record<string, unknown>
  const result: Record<string, EntryRow[]> = {}
  for (const moduleKey of Object.keys(SEED_ROWS)) {
    const value = record[moduleKey]
    if (value === undefined) {
      result[moduleKey] = clone(SEED_ROWS[moduleKey])
      continue
    }
    if (!Array.isArray(value)) {
      throw new DataReadError(`本地「${moduleKey}」数据结构不正确，请重试或恢复为示例数据`)
    }
    result[moduleKey] = clone(value) as EntryRow[]
  }
  return result
}

/** 宽松读取：仅供通用模块使用，坏数据回退种子，保持原有体验。 */
function readStorageLenient(): Record<string, EntryRow[]> {
  try {
    return readStorageStrict()
  } catch {
    return seedAll()
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorageLenient()
  }
  return cache
}

/** 应急模块专用：读取失败向上抛错，由页面区分「读取失败」与「空结果」。 */
export function allRowsStrict(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorageStrict()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
  emitChange('save', key)
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

/** 恢复全部示例数据（读取失败后的显式恢复入口）。 */
export function reseedAll(): Record<string, EntryRow[]> {
  const seeded = seedAll()
  cache = seeded
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
  }
  emitChange('reset')
  return seeded
}

/** 注入一段损坏内容，用于演示「读取失败」与「空结果」的不同提示。 */
export function corruptStorage(): void {
  cache = null
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, '{应急数据读取失败演示：这不是合法JSON')
  }
  emitChange('reset')
}

export function subscribeStore(listener: StoreChangeListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emitChange(reason: StoreChangeReason, key?: string): void {
  listeners.forEach((listener) => listener(reason, key))
}

// 跨标签页并发：其他标签页写入后，本标签页缓存作废，详情/列表下次读取拿到最新有效记录。
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) {
      cache = null
      emitChange('cross-tab')
    }
  })
}

export function storageKey(): string {
  return STORAGE_KEY
}
