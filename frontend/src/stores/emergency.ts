import { defineStore } from 'pinia'

import { advanceStatus, EMPTY_FILTERS, loadEvents } from '@/api/emergency-service'
import type { EmergencyEvent, EmergencyFilters } from '@/data/types'

type StatePhase = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

// 应急工作台的唯一页面状态：列表、分组、统计全部从同一份 events 派生。
// 进详情再返回时，这个 store 不销毁，过滤条件、滚动位置、定位行都还在。
export const useEmergencyStore = defineStore('emergency', {
  state: () => ({
    events: [] as EmergencyEvent[],
    total: 0,
    phase: 'idle' as StatePhase,
    errorMessage: '',
    filters: { ...EMPTY_FILTERS } as EmergencyFilters,
    // 需要高亮/滚动定位的事件 id（从详情返回或其他页面跳入时使用）。
    focusId: null as number | null,
    // 离开工作台前往详情前的滚动位置，返回后恢复。
    scrollTop: 0,
  }),
  getters: {
    // 按事件状态分组：和列表、统计共用 events，不会出现各块数据对不上。
    groups(state): { status: string; items: EmergencyEvent[] }[] {
      const order = ['待响应', '响应中', '处置中', '已处置']
      return order.map((status) => ({
        status,
        items: state.events.filter((event) => event.status === status),
      }))
    },
    statusCounts(state): Record<string, number> {
      const counts: Record<string, number> = { 待响应: 0, 响应中: 0, 处置中: 0, 已处置: 0 }
      for (const event of state.events) {
        counts[event.status] = (counts[event.status] ?? 0) + 1
      }
      return counts
    },
    getById: (state) => (id: number) => state.events.find((event) => event.id === id) ?? null,
  },
  actions: {
    // 统一读取口径：过滤结果、分组、统计、定位全部基于本次载入的同一批数据。
    load() {
      this.phase = 'loading'
      this.errorMessage = ''
      try {
        const payload = loadEvents(this.filters)
        this.events = payload.items as EmergencyEvent[]
        this.total = payload.total
        this.phase = payload.items.length === 0 ? 'empty' : 'ready'
      } catch (error) {
        // 读取失败与“查到 0 条”是两回事，分别用 error/empty 表示。
        this.phase = 'error'
        this.errorMessage = error instanceof Error ? error.message : '应急事件列表读取失败，请稍后重试'
      }
    },
    setFilters(next: EmergencyFilters) {
      this.filters = { ...next }
      this.load()
    },
    resetFilters() {
      this.filters = { ...EMPTY_FILTERS }
      this.focusId = null
      this.load()
    },
    requestFocus(id: number | null) {
      this.focusId = id
    },
    clearFocus() {
      this.focusId = null
    },
    saveScroll(top: number) {
      this.scrollTop = top
    },
    // 从详情返回：保留条件与位置，只做数据刷新；返回后由页面恢复滚动并定位 focusId。
    returnFromDetail() {
      this.load()
    },
    // 详情页处置动作：成功后刷新同一数据集；并发冲突时不覆盖，回传最新记录供页面提示。
    async advance(id: number, action: string, revision: number, note = '') {
      const result = advanceStatus(id, action, revision, note)
      if (result.ok) {
        this.load()
      }
      return result
    },
  },
})
