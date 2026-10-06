import { defineStore } from 'pinia'

import {
  advanceEmergency,
  applyEmergencyFilters,
  emptyEmergencyFilters,
  getEmergency,
  hasActiveFilters,
  listEmergencies,
  restoreEmergencyData,
  simulateReadFailure,
  type EmergencyFilters,
} from '@/api/emergency-service'
import { DataReadError, subscribeStore } from '@/data/local-store'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

// 返回工作台后要还原的内容：过滤条件、当前分组与滚动位置。
const VIEW_STATE_KEY = 'underground-pipeline-inspection:emergency-view'

type PersistedViewState = {
  filters: EmergencyFilters
  selectedId: number | null
  scrollY: number
}

function loadPersistedViewState(): PersistedViewState | null {
  if (typeof window === 'undefined' || !window.sessionStorage) return null
  const raw = window.sessionStorage.getItem(VIEW_STATE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as PersistedViewState
    return {
      filters: { ...emptyEmergencyFilters(), ...(parsed.filters ?? {}) },
      selectedId: typeof parsed.selectedId === 'number' ? parsed.selectedId : null,
      scrollY: typeof parsed.scrollY === 'number' ? parsed.scrollY : 0,
    }
  } catch {
    return null
  }
}

function savePersistedViewState(state: PersistedViewState): void {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    window.sessionStorage.setItem(VIEW_STATE_KEY, JSON.stringify(state))
  }
}

export type EmergencyLoadState = 'idle' | 'loading' | 'ready' | 'error'

// 跨标签页订阅只需一份：store 卸载时可退订，避免重复 reload。
let crossTabUnsubscribe: (() => void) | undefined

export const useEmergencyWorkspaceStore = defineStore('emergencyWorkspace', {
  state: () => {
    const persisted = loadPersistedViewState()
    return {
      // 同一批原始数据：表格行、状态分组、统计、定位全部从这里派生，不再各取各的。
      rows: [] as EntryRow[],
      loadState: 'idle' as EmergencyLoadState,
      errorMessage: '',
      filters: persisted?.filters ?? emptyEmergencyFilters(),
      scopeTotal: 0,
      // 详情返回后定位用的稳定 id，绝不依赖行下标。
      selectedId: persisted?.selectedId ?? null,
      // 进入详情时的滚动位置，返回后还原。
      scrollY: persisted?.scrollY ?? 0,
      // 用于高亮刚定位回来的那一行。
      locateToken: 0,
      // 异步读取序号：只接受最后一次请求的结果，杜绝旧响应覆盖新数据。
      requestSeq: 0,
      actionMessage: '',
      actionError: '',
    }
  },
  getters: {
    activeFilters(state): boolean {
      return hasActiveFilters(state.filters)
    },
    /** 过滤、分组、定位共用的唯一一批结果。 */
    visibleRows(state): EntryRow[] {
      return applyEmergencyFilters(state.rows, state.filters)
    },
    total(state): number {
      return state.rows.length
    },
    statusGroups(state): { status: string; rows: EntryRow[] }[] {
      const visible = applyEmergencyFilters(state.rows, state.filters)
      return ['待响应', '响应中', '处置中', '已处置'].map((status) => ({
        status,
        rows: visible.filter((row) => String(row.status) === status),
      }))
    },
    statusSummary(state): { status: string; count: number }[] {
      const visible = applyEmergencyFilters(state.rows, state.filters)
      return ['待响应', '响应中', '处置中', '已处置'].map((status) => ({
        status,
        count: visible.filter((row) => String(row.status) === status).length,
      }))
    },
    selectedRow(state): EntryRow | null {
      if (state.selectedId === null) return null
      return state.rows.find((row) => Number(row.id) === state.selectedId) ?? null
    },
  },
  actions: {
    persistViewState() {
      savePersistedViewState({
        filters: { ...this.filters },
        selectedId: this.selectedId,
        scrollY: this.scrollY,
      })
    },
    updateFilters(patch: Partial<EmergencyFilters>) {
      this.filters = { ...this.filters, ...patch }
      this.persistViewState()
    },
    resetFilters() {
      this.filters = emptyEmergencyFilters()
      this.persistViewState()
      this.reload()
    },
    markSelected(id: number) {
      this.selectedId = id
      this.locateToken += 1
      this.persistViewState()
    },
    rememberScroll(y: number) {
      this.scrollY = y
      this.persistViewState()
    },
    /** 拉取同一批数据；regions 为当前账号的区域权限。过滤在 getters 里做，保证各视图同源。 */
    reload() {
      const session = useSessionStore()
      const seq = ++this.requestSeq
      this.loadState = 'loading'
      this.errorMessage = ''
      try {
        const payload = listEmergencies(emptyEmergencyFilters(), session.regions)
        if (seq !== this.requestSeq) return
        this.rows = payload.items
        this.scopeTotal = payload.scopeTotal
        this.loadState = 'ready'
      } catch (error) {
        if (seq !== this.requestSeq) return
        this.loadState = 'error'
        this.rows = []
        this.errorMessage =
          error instanceof DataReadError ? error.message : '应急事件列表读取失败，请稍后重试'
      }
    },
    /** 详情页读取：与列表同一份存储，按 id 稳定定位，并做越权判定。 */
    loadDetail(id: number) {
      const session = useSessionStore()
      return getEmergency(id, session.regions)
    },
    advance(id: number, action: string, expectedVersion?: number, note?: string) {
      const session = useSessionStore()
      this.actionMessage = ''
      this.actionError = ''
      try {
        const result = advanceEmergency(id, action, session.operator, expectedVersion, note)
        if (result.ok) {
          this.actionMessage = result.message
          // 写成功后用最新数据刷新同一批结果；过滤条件保持不变。
          this.reload()
        } else {
          this.actionError = result.message
          if (result.conflict && result.latest) {
            // 并发冲突：把最新有效记录纳入当前批次，界面随之落到最后有效版本。
            this.reload()
          }
        }
        return result
      } catch (error) {
        this.actionError = error instanceof Error ? error.message : '应急事件读取失败'
        return { ok: false, conflict: false, latest: null, message: this.actionError }
      }
    },
    simulateFailure() {
      simulateReadFailure()
      this.reload()
    },
    restoreData() {
      restoreEmergencyData()
      this.reload()
    },
    initCrossTabSync() {
      if (typeof window === 'undefined' || crossTabUnsubscribe) return
      // 其他标签页写入或本页显式恢复：作废本页旧批次，重新读取最后有效记录。
      crossTabUnsubscribe = subscribeStore((reason) => {
        if (reason === 'cross-tab' || reason === 'reset') {
          this.reload()
        }
      })
    },
    disposeCrossTabSync() {
      crossTabUnsubscribe?.()
      crossTabUnsubscribe = undefined
    },
  },
})
