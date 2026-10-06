<template>
  <section class="page" data-module="emergency">
    <header class="page-head">
      <div>
        <h2>应急事件工作台</h2>
        <p class="page-desc">
          围绕事件编号、事件类型、事发地点、危害等级统一登记、筛选、分组与状态流转。
          当前值班：<strong>{{ session.operator }}</strong>
          （{{ regionText }}）
        </p>
      </div>
      <div class="page-actions">
        <label class="operator-switch">
          <span>切换值班账号</span>
          <select :value="session.operator" @change="switchOperator">
            <option v-for="name in OPERATOR_NAMES" :key="name" :value="name">{{ name }}</option>
          </select>
        </label>
        <button class="btn" type="button" @click="exportRows">导出应急事件清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待响应事件</span>
        <strong class="stat-value">{{ store.statusCounts['待响应'] }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">响应中事件</span>
        <strong class="stat-value">{{ store.statusCounts['响应中'] }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">处置中事件</span>
        <strong class="stat-value">{{ store.statusCounts['处置中'] }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已处置事件</span>
        <strong class="stat-value">{{ store.statusCounts['已处置'] }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <a
        v-for="group in store.groups"
        :key="group.status"
        class="legend-item legend-link"
        :href="`#group-${group.status}`"
        @click.prevent="jumpGroup(group.status)"
      >
        {{ group.status }}：{{ group.items.length }}
      </a>
      <span class="legend-tip">列表、分组、统计与定位使用同一批数据</span>
    </p>

    <form class="filter-bar" @submit.prevent="applyFilters">
      <label class="filter-item">
        <span>事发地点</span>
        <input v-model="form.事发地点" placeholder="按事发地点检索，如：城东" />
      </label>
      <label class="filter-item">
        <span>事件类型</span>
        <input v-model="form.事件类型" placeholder="按事件类型检索，如：泄漏" />
      </label>
      <button class="btn primary" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="clearFilters">重置条件</button>
      <span v-if="hasActiveFilters" class="filter-active-tip">
        已启用筛选：{{ activeFilterText }}
      </span>
    </form>

    <p v-if="store.phase === 'loading'" class="state-loading">正在读取应急事件…</p>

    <div v-else-if="store.phase === 'error'" class="state-panel state-error" role="alert">
      <strong>应急事件列表读取失败</strong>
      <span>{{ store.errorMessage || '本地数据读取异常' }}</span>
      <button class="btn" type="button" @click="store.load()">重试</button>
    </div>

    <div v-else-if="store.phase === 'empty'" class="state-panel state-empty">
      <template v-if="!session.allowedRegions.length">
        <strong>当前账号没有任何辖区的查看权限</strong>
        <span>请联系指挥中心为「{{ session.operator }}」分配辖区，过滤条件无法绕过权限范围。</span>
      </template>
      <template v-else>
        <strong>没有符合条件的应急事件</strong>
        <span v-if="hasActiveFilters">
          在您的辖区（{{ regionText }}）内，条件「{{ activeFilterText }}」匹配到 0 条记录，不是读取失败。
        </span>
        <span v-else>您的辖区（{{ regionText }}）内暂时没有应急事件。</span>
        <button v-if="hasActiveFilters" class="btn" type="button" @click="clearFilters">清空筛选条件</button>
      </template>
    </div>

    <template v-else>
      <p v-if="bannerMessage" class="inline-banner" :class="bannerError ? 'error-text' : 'ok-text'">
        {{ bannerMessage }}
      </p>
      <section
        v-for="group in store.groups"
        :id="`group-${group.status}`"
        :key="group.status"
        class="event-group"
      >
        <h3 class="group-head">
          {{ group.status }}
          <span class="group-count">{{ group.items.length }} 件</span>
        </h3>
        <table class="data-table">
          <thead>
            <tr>
              <th v-for="column in columns" :key="column">{{ column }}</th>
              <th>当前状态</th>
              <th>可执行动作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in group.items"
              :id="`event-${row.id}`"
              :key="String(row.id)"
              :class="{ 'row-focus': store.focusId === row.id }"
            >
              <td v-for="column in columns" :key="column">{{ display(row, column) }}</td>
              <td>
                <span class="status-pill">{{ row.status }}</span>
                <span class="cell-sub">辖区：{{ row.辖区 }}</span>
              </td>
              <td class="row-actions">
                <button
                  v-for="action in actionsFor(row)"
                  :key="action"
                  class="link"
                  type="button"
                  @click="runAction(action, row)"
                >
                  {{ action }}
                </button>
                <RouterLink class="link" :to="`/emergency/${row.id}`">查看详情</RouterLink>
              </td>
            </tr>
            <tr v-if="!group.items.length">
              <td :colspan="columns.length + 2" class="empty-state">该状态分组下暂无匹配事件</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <footer class="page-foot">
      <span>共 {{ store.total }} 条应急事件记录（{{ regionText }}）</span>
      <span v-if="store.errorMessage" class="error-text">{{ store.errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'

import { downloadEntries } from '@/api/local-service'
import type { EmergencyEvent } from '@/data/types'
import { useEmergencyStore } from '@/stores/emergency'
import { OPERATOR_NAMES, useSessionStore } from '@/stores/session'

const store = useEmergencyStore()
const session = useSessionStore()

const columns = ['事件编号', '事件类型', '事发地点', '危害等级', '接报时间', '处置时限']
// 表单只绑这两个条件；辖区由账号权限决定，不允许通过填过滤条件越权查看。
const form = reactive({
  事发地点: store.filters.事发地点,
  事件类型: store.filters.事件类型,
})

const bannerMessage = ref('')
const bannerError = ref(false)

const hasActiveFilters = computed(
  () => form.事发地点.trim() !== '' || form.事件类型.trim() !== '',
)
const activeFilterText = computed(() =>
  [
    form.事发地点.trim() ? `事发地点含“${form.事发地点.trim()}”` : '',
    form.事件类型.trim() ? `事件类型含“${form.事件类型.trim()}”` : '',
  ]
    .filter(Boolean)
    .join('，'),
)
const regionText = computed(() =>
  session.isCityWide ? '全部辖区' : session.allowedRegions.join('、') || '无授权辖区',
)

function display(row: EmergencyEvent, column: string): string {
  const value = row[column]
  return value === undefined || value === '' || value === '—' ? '—' : String(value)
}

// 状态机：处置中不允许回退去“启动响应”，只呈现当前可执行的下一步。
function actionsFor(row: EmergencyEvent): string[] {
  switch (row.status) {
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

function applyFilters() {
  bannerMessage.value = ''
  store.requestFocus(null)
  store.setFilters({ ...form })
}

function clearFilters() {
  form.事发地点 = ''
  form.事件类型 = ''
  store.resetFilters()
}

function switchOperator(event: Event) {
  session.setOperator((event.target as HTMLSelectElement).value)
  // 切换账号后权限范围变化：用新账号的辖区重新读取同一套数据源，并清掉可能越权的定位。
  store.requestFocus(null)
  store.load()
}

function exportRows() {
  downloadEntries('emergency')
}

async function runAction(action: string, row: EmergencyEvent) {
  bannerMessage.value = ''
  const result = await store.advance(row.id, action, row.修订版本)
  bannerError.value = !result.ok
  bannerMessage.value = result.message
  // 并发冲突或成功后数据已刷新，分组/统计自动跟随最新的同一批数据。
  if (result.ok) {
    store.requestFocus(row.id)
    await nextTick()
    scrollToEvent(row.id)
  }
}

function jumpGroup(status: string) {
  document.getElementById(`group-${status}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function scrollToEvent(id: number) {
  const el = document.getElementById(`event-${id}`)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

function onStorageChanged(event: Event) {
  const detail = (event as CustomEvent<{ key?: string }>).detail
  // 其它标签页更新了应急事件：重新拉取，避免“清空后显示旧记录/处置后停留旧状态”。
  if (!detail || detail.key === 'emergency') {
    store.load()
  }
}

function onScroll() {
  store.saveScroll(window.scrollY)
}

onMounted(async () => {
  // 表单始终以 store 中保留的条件为准（从详情返回时条件还在）。
  form.事发地点 = store.filters.事发地点
  form.事件类型 = store.filters.事件类型
  store.load()
  await nextTick()
  // 从详情返回：优先定位到该事件；若它不在当前过滤结果中，则恢复离开前的滚动位置。
  if (store.focusId !== null && store.getById(store.focusId)) {
    scrollToEvent(store.focusId)
  } else if (store.scrollTop > 0) {
    window.scrollTo(0, store.scrollTop)
  }
  window.addEventListener('entries:changed', onStorageChanged as EventListener)
  window.addEventListener('scroll', onScroll, { passive: true })
})

onBeforeUnmount(() => {
  store.saveScroll(window.scrollY)
  window.removeEventListener('entries:changed', onStorageChanged as EventListener)
  window.removeEventListener('scroll', onScroll)
})
</script>

<style scoped>
.page-actions {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
.operator-switch {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--muted);
}
.operator-switch select {
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.legend-link {
  text-decoration: none;
  cursor: pointer;
}
.legend-tip {
  margin-left: auto;
  background: none;
  padding: 2px 0;
}
.filter-active-tip {
  font-size: 12px;
  color: var(--brand);
  align-self: center;
}
.event-group {
  margin-bottom: 18px;
  scroll-margin-top: 8px;
}
.group-head {
  font-size: 14px;
  margin: 0 0 6px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.group-count {
  font-size: 12px;
  color: var(--muted);
  background: #eef2f7;
  border-radius: 999px;
  padding: 1px 10px;
}
.row-focus {
  outline: 2px solid var(--brand);
  outline-offset: -2px;
  background: #eef5ff;
  transition: background 0.6s ease;
}
.cell-sub {
  display: block;
  font-size: 11px;
  color: var(--muted);
  margin-top: 2px;
}
.status-pill {
  background: #e8f0fe;
  border-radius: 999px;
  padding: 1px 10px;
  font-size: 12px;
}
.state-loading {
  background: #fff;
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 18px;
  text-align: center;
  color: var(--muted);
}
.state-panel {
  background: #fff;
  border-radius: 8px;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
  border: 1px solid var(--border);
}
.state-empty {
  border-style: dashed;
  color: var(--muted);
}
.state-error {
  border-color: #f0a9a2;
  background: #fef3f2;
}
.state-error strong {
  color: #b42318;
}
.inline-banner {
  margin: 0 0 8px;
  font-size: 13px;
}
.ok-text {
  color: #17653a;
}
</style>
