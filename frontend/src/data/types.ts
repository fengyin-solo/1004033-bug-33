/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

/** 单条响应/处置流水：无论状态被谁更新，历史响应过程都按顺序保留下来。 */
export type ResponseRecord = {
  seq: number
  action: string
  fromStatus: string
  toStatus: string
  operator: string
  time: string
  note?: string
}

/** 业务字段允许携带结构化内容（如应急事件的响应记录）。 */
export type FieldValue = string | number | boolean | ResponseRecord[]

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  /** 乐观锁版本：每次成功流转 +1，并发提交旧版本会被拒绝。 */
  version?: number
  [field: string]: FieldValue | undefined
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
