<template>
  <section class="page emergency-page" data-module="emergency">
    <header class="page-head">
      <div>
        <h2>应急事件管理</h2>
        <p class="page-desc">围绕事件编号、事件类型、事发地点、危害等级做登记、筛选与状态流转；过滤、分组与定位使用同一批数据。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="openCreate">登记应急事件</button>
        <button class="btn" type="button" @click="exportRows">导出当前清单</button>
      </div>
    </header>

    <div class="scope-bar">
      <span class="scope-tag">当前身份：{{ session.roleLabel }}</span>
      <span class="scope-tag">数据范围：{{ scopeText }}</span>
      <label class="role-switch">
        切换身份（权限演示）
        <select :value="session.role" @change="onRoleChange">
          <option v-for="option in ROLE_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
      <button class="btn ghost danger" type="button" @click="simulateFailure">模拟读取失败</button>
    </div>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in store.statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="store.reload()">
      <label class="filter-item">
        <span>事件编号</span>
        <input v-model="codeFilter" placeholder="按事件编号检索" />
      </label>
      <label class="filter-item">
        <span>事件类型</span>
        <input v-model="typeFilter" placeholder="如 燃气管道泄漏" list="emergency-type-options" />
        <datalist id="emergency-type-options">
          <option v-for="type in typeOptions" :key="type" :value="type" />
        </datalist>
      </label>
      <label class="filter-item">
        <span>事发地点</span>
        <input v-model="locationFilter" placeholder="按事发地点检索" />
      </label>
      <label class="filter-item">
        <span>事件状态</span>
        <select v-model="statusFilter">
          <option value="">全部状态</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>所属区域</span>
        <select v-model="regionFilter">
          <option value="">全部区域</option>
          <option v-for="region in regionOptions" :key="region" :value="region">{{ region }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询/刷新</button>
      <button class="btn ghost" type="button" @click="store.resetFilters()">重置条件</button>
    </form>

    <p v-if="locateHint" class="locate-banner" :class="locateHint.tone">
      {{ locateHint.text }}
      <button v-if="locateHint.tone === 'warn'" class="link" type="button" @click="store.resetFilters()">清除条件后定位</button>
      <button class="link" type="button" @click="clearLocate">知道了</button>
    </p>

    <p v-if="store.actionMessage" class="action-banner ok">{{ store.actionMessage }}</p>
    <p v-if="store.actionError" class="action-banner err">{{ store.actionError }}</p>

    <!-- 读取失败：与空结果完全分开，给出重试与恢复入口 -->
    <div v-if="store.loadState === 'error'" class="state-panel error-panel">
      <strong>应急事件读取失败</strong>
      <p>{{ store.errorMessage }}</p>
      <div class="state-actions">
        <button class="btn primary" type="button" @click="store.reload()">重试读取</button>
        <button class="btn" type="button" @click="store.restoreData()">恢复为示例数据</button>
      </div>
    </div>

    <template v-else>
      <div v-for="group in store.statusGroups" :key="group.status" class="status-group">
        <h3 class="group-title">
          {{ group.status }}
          <span class="group-count">{{ group.rows.length }} 起</span>
        </h3>
        <table class="data-table">
          <thead>
            <tr>
              <th v-for="column in columns" :key="column">{{ column }}</th>
              <th>可执行动作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in group.rows"
              :key="String(row.id)"
              :ref="(el) => bindRowEl(row.id, el as HTMLElement | null)"
              :class="{ 'locate-flash': store.selectedId === Number(row.id) }"
              @click="openDetail(row.id)"
            >
              <td v-for="column in columns" :key="column">
                <button v-if="column === '事件编号'" class="link" type="button" @click.stop="openDetail(row.id)">
                  {{ row[column] }}
                </button>
                <span v-else>{{ row[column] ?? '—' }}</span>
              </td>
              <td class="row-actions" @click.stop>
                <button
                  v-for="action in availableActions(row)"
                  :key="action"
                  class="link"
                  type="button"
                  @click="runInlineAction(action, row)"
                >
                  {{ action }}
                </button>
                <span v-if="!availableActions(row).length" class="muted-text">已闭环</span>
              </td>
            </tr>
            <tr v-if="!group.rows.length">
              <td :colspan="columns.length + 1" class="empty-state">本组暂无应急事件</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 空结果：说明是条件没命中，而不是读不出数据 -->
      <div v-if="store.loadState === 'ready' && !store.visibleRows.length" class="state-panel empty-panel">
        <strong>没有符合条件的应急事件</strong>
        <p>当前权限范围共 {{ store.scopeTotal }} 起事件，但过滤条件没有命中任何记录。</p>
        <div class="state-actions">
          <button class="btn primary" type="button" @click="store.resetFilters()">清空过滤条件</button>
        </div>
      </div>
    </template>

    <footer class="page-foot">
      <span>
        权限范围内共 {{ store.scopeTotal }} 起
        <template v-if="store.activeFilters">，当前条件命中 {{ store.visibleRows.length }} 起</template>
      </span>
      <span v-if="store.loadState === 'loading'" class="muted-text">正在读取…</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { downloadEntries } from '@/api/local-service'
import { EMERGENCY_STATUSES, REGION_FIELD } from '@/api/emergency-service'
import { useEmergencyWorkspaceStore } from '@/stores/emergency-workspace'
import { ROLE_OPTIONS, useSessionStore, type SessionRole } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const route = useRoute()
const router = useRouter()
const store = useEmergencyWorkspaceStore()
const session = useSessionStore()

const columns = ['事件编号', '事件类型', '事发地点', REGION_FIELD, '危害等级', '接报时间']
const statuses = [...EMERGENCY_STATUSES]

const codeFilter = computed({
  get: () => store.filters.code,
  set: (value: string) => store.updateFilters({ code: value }),
})
const typeFilter = computed({
  get: () => store.filters.type,
  set: (value: string) => store.updateFilters({ type: value }),
})
const locationFilter = computed({
  get: () => store.filters.location,
  set: (value: string) => store.updateFilters({ location: value }),
})
const statusFilter = computed({
  get: () => store.filters.status,
  set: (value: string) => store.updateFilters({ status: value }),
})
const regionFilter = computed({
  get: () => store.filters.region,
  set: (value: string) => store.updateFilters({ region: value }),
})

const scopeText = computed(() =>
  session.regions === null ? '全市全部区域' : session.regions.join('、'),
)

// 下拉项只给当前权限范围内出现过的区域/类型：越权区域不出现在任何可选项里。
const regionOptions = computed(() => {
  const values = new Set(store.rows.map((row) => String(row[REGION_FIELD] ?? '')).filter(Boolean))
  return [...values]
})
const typeOptions = computed(() => {
  const values = new Set(store.rows.map((row) => String(row['事件类型'] ?? '')).filter(Boolean))
  return [...values]
})

const stats = computed(() => {
  const countOf = (status: string) =>
    store.visibleRows.filter((row) => String(row.status) === status).length
  return [
    { label: '待响应事件', value: countOf('待响应') },
    { label: '响应中事件', value: countOf('响应中') + countOf('处置中') },
    { label: '已处置事件', value: countOf('已处置') },
  ]
})

function availableActions(row: EntryRow): string[] {
  switch (String(row.status)) {
    case '待响应':
      return ['启动响应']
    case '响应中':
      return ['制定方案']
    case '处置中':
      return ['确认处置']
    default:
      return []
  }
}

function openCreate() {
  store.actionError = '应急事件登记入口尚未接入审批流'
}

function exportRows() {
  downloadEntries('emergency')
}

function openDetail(id: number) {
  store.markSelected(id)
  store.rememberScroll(window.scrollY)
  router.push({ name: 'emergency-detail', params: { id: String(id) } })
}

function runInlineAction(action: string, row: EntryRow) {
  void store.advance(Number(row.id), action, Number(row.version ?? 0))
}

function onRoleChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value as SessionRole
  session.switchRole(value)
  store.selectedId = null
  store.reload()
}

// 详情返回后的定位提示：找不到目标时不悄悄落到别的行。
const locateHint = ref<{ text: string; tone: 'ok' | 'warn' } | null>(null)
let hintTimer: number | undefined

function clearLocate() {
  locateHint.value = null
  store.selectedId = null
  store.persistViewState()
}

const rowElements = new Map<number, HTMLElement>()
function bindRowEl(id: number, el: HTMLElement | null) {
  if (el) {
    rowElements.set(id, el)
  } else {
    rowElements.delete(id)
  }
}

async function restorePositionIfNeeded() {
  await nextTick()
  if (store.selectedId !== null) {
    const targetId = store.selectedId
    const target = store.visibleRows.find((row) => Number(row.id) === targetId)
    if (target) {
      const el = rowElements.get(targetId)
      el?.scrollIntoView({ behavior: 'auto', block: 'center' })
      locateHint.value = { text: `已定位到事件 ${target['事件编号']}`, tone: 'ok' }
    } else {
      // 目标不在当前过滤批次里：明确告知，而不是定位到错误记录。
      const stillExists = store.rows.some((row) => Number(row.id) === targetId)
      locateHint.value = stillExists
        ? { text: '事件存在，但不满足当前过滤条件，未能在列表中定位。', tone: 'warn' }
        : { text: '要定位的应急事件已不在当前权限范围内或已被删除。', tone: 'warn' }
    }
    window.clearTimeout(hintTimer)
    hintTimer = window.setTimeout(() => {
      locateHint.value = null
    }, 4000)
  } else {
    // 从详情返回但无定位目标时，还原离开时的滚动位置。
    window.scrollTo({ top: store.scrollY ?? 0 })
  }
}

function simulateFailure() {
  store.simulateFailure()
}

// 路由 query 可覆盖保存的条件，保证链接可分享；无 query 时沿用返回时保留的条件。
function hydrateFiltersFromQuery() {
  const q = route.query
  if (Object.keys(q).length === 0) return
  store.updateFilters({
    code: typeof q.code === 'string' ? q.code : store.filters.code,
    type: typeof q.type === 'string' ? q.type : store.filters.type,
    location: typeof q.location === 'string' ? q.location : store.filters.location,
    status: typeof q.status === 'string' ? q.status : store.filters.status,
    region: typeof q.region === 'string' ? q.region : store.filters.region,
  })
}

onMounted(() => {
  store.initCrossTabSync()
  hydrateFiltersFromQuery()
  store.reload()
  void restorePositionIfNeeded()
})

onActivated(() => {
  void restorePositionIfNeeded()
})

onBeforeUnmount(() => {
  store.rememberScroll(window.scrollY)
  store.disposeCrossTabSync()
  window.clearTimeout(hintTimer)
})
</script>

<style scoped>
.scope-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  background: #eef4ff;
  border: 1px solid #cfe0ff;
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  font-size: 12px;
}
.scope-tag {
  background: #fff;
  border: 1px solid #cfe0ff;
  border-radius: 999px;
  padding: 2px 10px;
  color: #1f4e9e;
}
.role-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
}
.btn.danger {
  color: #b42318;
  border-color: #f0b8b0;
}
.status-group {
  margin-bottom: 14px;
}
.group-title {
  font-size: 14px;
  margin: 8px 0 6px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.group-count {
  font-size: 12px;
  color: var(--muted);
  background: #eef2f7;
  border-radius: 999px;
  padding: 1px 8px;
}
.data-table tbody tr {
  cursor: pointer;
}
.locate-flash {
  animation: locate-flash 1.6s ease 0s 2;
}
@keyframes locate-flash {
  0%, 100% { background: #fff; }
  50% { background: #fff3cd; }
}
.state-panel {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  text-align: center;
  border: 1px dashed var(--border);
}
.state-panel strong {
  display: block;
  margin-bottom: 6px;
}
.state-panel p {
  color: var(--muted);
  font-size: 13px;
  margin: 0 0 12px;
}
.state-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
}
.error-panel {
  border-color: #f0b8b0;
  background: #fef3f2;
}
.empty-panel {
  background: #fff;
}
.locate-banner {
  font-size: 13px;
  border-radius: 6px;
  padding: 8px 10px;
  margin: 0 0 10px;
  display: flex;
  gap: 12px;
  align-items: center;
}
.locate-banner.ok {
  background: #ecfdf3;
  border: 1px solid #abefc6;
  color: #067647;
}
.locate-banner.warn {
  background: #fffaeb;
  border: 1px solid #fedf89;
  color: #b54708;
}
.action-banner {
  font-size: 13px;
  border-radius: 6px;
  padding: 8px 10px;
  margin: 0 0 10px;
}
.action-banner.ok {
  background: #ecfdf3;
  border: 1px solid #abefc6;
  color: #067647;
}
.action-banner.err {
  background: #fef3f2;
  border: 1px solid #fda29b;
  color: #b42318;
}
.muted-text {
  color: var(--muted);
}
</style>
