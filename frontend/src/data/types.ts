/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean | HistoryEntry[]
}

// 应急事件的一次响应/处置过程记录：状态可以被并发覆盖，过程始终留痕可查。
export type HistoryEntry = {
  action: string
  fromStatus: string
  toStatus: string
  operator: string
  time: string
  note?: string
}

export type EmergencyEvent = EntryRow & {
  辖区: string
  修订版本: number
  响应过程: HistoryEntry[]
}

export type EmergencyFilters = {
  事发地点: string
  事件类型: string
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
