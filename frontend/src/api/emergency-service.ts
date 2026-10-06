import { allRowsStrict, corruptStorage, reseedAll, saveRows } from '@/data/local-store'
import type { EntryRow, ResponseRecord } from '@/data/types'

/** 应急事件在记录上携带的区域字段，也是越权校验依据。 */
export const REGION_FIELD = '所属区域'
export const HISTORY_FIELD = '响应记录'

export const EMERGENCY_STATUSES = ['待响应', '响应中', '处置中', '已处置'] as const

/** 允许执行的动作及目标状态：不能跳步，也不能重复流转。 */
export const EMERGENCY_ACTION_TARGET: Record<string, string> = {
  启动响应: '响应中',
  制定方案: '处置中',
  确认处置: '已处置',
}

export type EmergencyFilters = {
  code: string
  type: string
  location: string
  status: string
  region: string
}

export function emptyEmergencyFilters(): EmergencyFilters {
  return { code: '', type: '', location: '', status: '', region: '' }
}

export function hasActiveFilters(filters: EmergencyFilters): boolean {
  return Object.values(filters).some((value) => value.trim() !== '')
}

export type EmergencyListResult = {
  items: EntryRow[]
  /** 当前权限范围内的事件总数（不受过滤条件影响）。 */
  scopeTotal: number
  /** 过滤后的条数。 */
  total: number
}

export type EmergencyDetailResult =
  | { ok: true; row: EntryRow }
  | { ok: false; reason: 'denied' | 'missing'; message: string }

export type AdvanceResult =
  | { ok: true; row: EntryRow; message: string }
  | { ok: false; conflict: boolean; latest: EntryRow | null; message: string }

function regionOf(row: EntryRow): string {
  return String(row[REGION_FIELD] ?? '')
}

/** 纯函数：在同一批数据上做关键字过滤，过滤、分组、定位共用它。 */
export function applyEmergencyFilters(rows: EntryRow[], filters: EmergencyFilters): EntryRow[] {
  const code = filters.code.trim()
  const type = filters.type.trim()
  const location = filters.location.trim()
  const status = filters.status.trim()
  const region = filters.region.trim()
  return rows.filter((row) => {
    if (code && !String(row['事件编号'] ?? '').includes(code)) return false
    if (type && !String(row['事件类型'] ?? '').includes(type)) return false
    if (location && !String(row['事发地点'] ?? '').includes(location)) return false
    if (status && String(row.status) !== status) return false
    if (region && regionOf(row) !== region) return false
    return true
  })
}

/**
 * 应急事件列表：先按人员区域收权，再在同一批结果上过滤。
 * 越权人员即使在条件里填写其他区域，也只会在自己有权限的批次里检索。
 */
export function listEmergencies(
  filters: EmergencyFilters,
  regions: string[] | null,
): EmergencyListResult {
  const all = allRowsStrict()['emergency'] ?? []
  const scoped = regions === null ? all : all.filter((row) => regions.includes(regionOf(row)))
  const items = applyEmergencyFilters(scoped, filters)
  return { items, scopeTotal: scoped.length, total: items.length }
}

/** 详情读取：不存在与越权分开判定，但越权不回显任何事件信息。 */
export function getEmergency(id: number, regions: string[] | null): EmergencyDetailResult {
  const all = allRowsStrict()['emergency'] ?? []
  const row = all.find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, reason: 'missing', message: `没有找到编号为 ${id} 的应急事件，可能已被处置归档或编号有误` }
  }
  if (regions !== null && !regions.includes(regionOf(row))) {
    return { ok: false, reason: 'denied', message: '当前账号无权查看该区域的应急事件，请联系管理员开通区域权限' }
  }
  return { ok: true, row }
}

function historyOf(row: EntryRow): ResponseRecord[] {
  const value = row[HISTORY_FIELD]
  return Array.isArray(value) ? (value as ResponseRecord[]) : []
}

function nowStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 处置流转：
 * - 版本号乐观锁：并发时基于旧版本的提交一律拒绝，只接受最后一次有效提交，列表/详情只显示最后有效记录；
 * - 每次流转都追加到「响应记录」，历史响应过程始终可查。
 */
export function advanceEmergency(
  id: number,
  action: string,
  operator: string,
  expectedVersion?: number,
  note = '',
): AdvanceResult {
  const target = EMERGENCY_ACTION_TARGET[action]
  if (!target) {
    return { ok: false, conflict: false, latest: null, message: `应急事件没有登记「${action}」这个动作` }
  }
  const all = allRowsStrict()['emergency'] ?? []
  const index = all.findIndex((item) => Number(item.id) === id)
  if (index < 0) {
    return { ok: false, conflict: false, latest: null, message: `没有找到编号为 ${id} 的应急事件` }
  }
  const current = all[index]
  if (typeof expectedVersion === 'number' && Number(current.version ?? 0) !== expectedVersion) {
    return {
      ok: false,
      conflict: true,
      latest: current,
      message: `该事件刚被其他值班人员更新到「${current.status}」，已为你加载最新记录，请基于最新状态再操作`,
    }
  }
  const currentStatus = String(current.status)
  if (currentStatus === target) {
    return { ok: false, conflict: false, latest: current, message: `事件已经是「${target}」，不用重复操作` }
  }
  const currentIndex = EMERGENCY_STATUSES.indexOf(currentStatus as (typeof EMERGENCY_STATUSES)[number])
  const targetIndex = EMERGENCY_STATUSES.indexOf(target as (typeof EMERGENCY_STATUSES)[number])
  if (targetIndex <= currentIndex) {
    return { ok: false, conflict: false, latest: current, message: `事件当前为「${currentStatus}」，不能回退到「${target}」` }
  }
  if (targetIndex !== currentIndex + 1) {
    return { ok: false, conflict: false, latest: current, message: `需要先完成「${EMERGENCY_STATUSES[currentIndex + 1]}」阶段，不能跳过` }
  }

  const history = historyOf(current)
  const record: ResponseRecord = {
    seq: history.length + 1,
    action,
    fromStatus: currentStatus,
    toStatus: target,
    operator,
    time: nowStamp(),
    note: note.trim() || undefined,
  }
  const nextVersion = Number(current.version ?? 0) + 1
  const updated: EntryRow = {
    ...current,
    status: target,
    pending: target !== EMERGENCY_STATUSES[EMERGENCY_STATUSES.length - 1],
    abnormal: false,
    version: nextVersion,
    [HISTORY_FIELD]: [...history, record],
  }
  const nextAll = [...all]
  nextAll[index] = updated
  saveRows('emergency', nextAll)
  return { ok: true, row: updated, message: `${action}成功，当前状态「${target}」` }
}

export function simulateReadFailure(): void {
  corruptStorage()
}

export function restoreEmergencyData(): void {
  reseedAll()
}

export function responseHistory(row: EntryRow): ResponseRecord[] {
  return historyOf(row)
}
