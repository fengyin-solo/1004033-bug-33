import { moduleMeta } from './local-service'
import { listRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EmergencyEvent,
  EmergencyFilters,
  EntryRow,
  HistoryEntry,
  PageResult,
} from '@/data/types'
import { useSessionStore } from '@/stores/session'

const KEY = 'emergency'

export const EMERGENCY_META = moduleMeta(KEY)
export const EMPTY_FILTERS: EmergencyFilters = { 事发地点: '', 事件类型: '' }

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function asEvent(row: EntryRow): EmergencyEvent {
  return {
    ...row,
    辖区: String(row.辖区 ?? ''),
    修订版本: typeof row.修订版本 === 'number' ? row.修订版本 : 1,
    响应过程: Array.isArray(row.响应过程) ? (row.响应过程 as HistoryEntry[]) : [],
  } as EmergencyEvent
}

// 列表、分组、详情、定位拿到的永远是同一批数据：本函数是应急事件的唯一读取口径。
// 顺序固定按 id 排序，任何视图都按下标外的稳定 id 定位，过滤/状态变化不会“跳到错误记录”。
export function loadEvents(filters: EmergencyFilters = EMPTY_FILTERS): PageResult {
  const session = useSessionStore()
  const place = normalize(filters.事发地点)
  const type = normalize(filters.事件类型)

  const items = listRows(KEY)
    .map(asEvent)
    .filter((row) => {
      // 越权兜底：无论过滤条件怎么填，非授权辖区的事件都不进入结果集。
      if (!session.canAccessRegion(row.辖区)) {
        return false
      }
      if (place && !normalize(String(row.事发地点)).includes(place)) {
        return false
      }
      if (type && !normalize(String(row.事件类型)).includes(type)) {
        return false
      }
      return true
    })
    .sort((a, b) => a.id - b.id)

  return { items, total: items.length, page: 1, size: items.length }
}

// 详情按稳定 id 读取；不存在或越权都返回 null，由页面区分“找不到”与“读取失败”。
export function getEvent(id: number): EmergencyEvent | null {
  const session = useSessionStore()
  const row = listRows(KEY).find((item) => Number(item.id) === id)
  if (!row) {
    return null
  }
  const event = asEvent(row)
  if (!session.canAccessRegion(event.辖区)) {
    return null
  }
  return event
}

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export type AdvanceResult = ActionResult & { event?: EmergencyEvent; conflict?: boolean }

// 状态流转：基于修订版本做乐观并发控制。
// 多个值班员几乎同时处置时，先到的更新生效，后到的基于旧版本提交会被拒绝并拿到最新记录——
// 因此“当前状态”只保留最后一次有效提交；每次有效提交都追加进响应过程，历史全程可查。
export function advanceStatus(
  id: number,
  action: string,
  expectedRevision: number,
  note = '',
): AdvanceResult {
  const session = useSessionStore()
  const target = EMERGENCY_META.actionTargets[action]
  if (!target) {
    return { ok: false, message: `应急事件没有登记「${action}」这个动作` }
  }

  const rows = listRows(KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的应急事件，可能已被其他值班员处置归档` }
  }

  const current = asEvent(rows[index])
  if (!session.canAccessRegion(current.辖区)) {
    // 不暴露越权记录是否存在，与列表口径一致。
    return { ok: false, message: `没有找到编号为 ${id} 的应急事件` }
  }

  if (current.修订版本 !== expectedRevision) {
    return {
      ok: false,
      conflict: true,
      event: current,
      message: `该事件刚被 ${current.响应过程[current.响应过程.length - 1]?.operator ?? '其他值班员'} 更新，当前状态已是「${current.status}」，请核对后再操作`,
    }
  }

  if (current.status === target) {
    return { ok: false, message: `事件已经是「${target}」，不用重复操作`, event: current }
  }

  const lastStatus = EMERGENCY_META.statuses[EMERGENCY_META.statuses.length - 1]
  const entry: HistoryEntry = {
    action,
    fromStatus: current.status,
    toStatus: target,
    operator: session.operator,
    time: nowText(),
    note: note || undefined,
  }
  const updated: EmergencyEvent = {
    ...current,
    status: target,
    pending: target !== lastStatus,
    修订版本: current.修订版本 + 1,
    响应过程: [...current.响应过程, entry],
  }

  const next = [...rows]
  next[index] = updated
  saveRows(KEY, next)
  return { ok: true, message: `已${action}，当前状态「${target}」`, event: updated }
}
