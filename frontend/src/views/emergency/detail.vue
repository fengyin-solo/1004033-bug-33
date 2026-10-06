<template>
  <section class="page emergency-detail" data-module="emergency-detail">
    <header class="page-head">
      <div>
        <h2>应急事件详情</h2>
        <p class="page-desc">查看事件信息与完整响应过程；处置状态以最后一次有效提交为准，历史记录逐条保留。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="backToWorkbench">返回应急工作台</button>
      </div>
    </header>

    <div class="scope-bar">
      <span class="scope-tag">当前身份：{{ session.roleLabel }}</span>
      <label class="role-switch">
        切换身份（权限演示）
        <select :value="session.role" @change="onRoleChange">
          <option v-for="option in ROLE_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
    </div>

    <div v-if="loadState === 'loading'" class="state-panel">正在读取事件详情…</div>

    <div v-else-if="loadState === 'error'" class="state-panel error-panel">
      <strong>应急事件读取失败</strong>
      <p>{{ errorText }}</p>
      <div class="state-actions">
        <button class="btn primary" type="button" @click="load">重试读取</button>
        <button class="btn" type="button" @click="store.restoreData()">恢复为示例数据</button>
        <button class="btn ghost" type="button" @click="backToWorkbench">返回工作台</button>
      </div>
    </div>

    <div v-else-if="loadState === 'denied'" class="state-panel denied-panel">
      <strong>无权查看该应急事件</strong>
      <p>{{ errorText }}</p>
      <div class="state-actions">
        <button class="btn primary" type="button" @click="backToWorkbench">返回自己的事件列表</button>
      </div>
    </div>

    <div v-else-if="loadState === 'missing'" class="state-panel missing-panel">
      <strong>未找到该应急事件</strong>
      <p>{{ errorText }}</p>
      <div class="state-actions">
        <button class="btn primary" type="button" @click="backToWorkbench">返回应急工作台</button>
      </div>
    </div>

    <template v-else-if="row">
      <div class="detail-grid">
        <article class="detail-card">
          <h3>基本信息</h3>
          <dl class="info-list">
            <div v-for="field in infoFields" :key="field" class="info-row">
              <dt>{{ field }}</dt>
              <dd>{{ row[field] ?? '—' }}</dd>
            </div>
          </dl>
        </article>

        <article class="detail-card">
          <h3>当前状态</h3>
          <p class="current-status">
            <span class="status-badge">{{ row.status }}</span>
            <span class="version-text">数据版本 v{{ Number(row.version ?? 0) }}</span>
          </p>
          <p class="plan-text">处置方案：{{ row['处置方案'] || '暂未制定' }}</p>

          <div class="action-box">
            <h4>处置流转</h4>
            <p class="box-tip">只能按「待响应 → 响应中 → 处置中 → 已处置」顺序推进，提交基于当前版本号校验。</p>
            <div v-if="nextAction" class="action-form">
              <label class="note-input">
                处置备注（可选）
                <input v-model="note" placeholder="记录本次处置要点" />
              </label>
              <div class="action-buttons">
                <button class="btn primary" type="button" :disabled="submitting" @click="submitAction(nextAction, Number(row.version ?? 0))">
                  {{ nextAction }}
                </button>
                <button class="btn ghost" type="button" :disabled="submitting" @click="simulateStaleSubmit(nextAction)">
                  模拟并发旧提交
                </button>
              </div>
            </div>
            <p v-else class="box-tip">该事件已处置闭环，如需重启请走重新立案流程。</p>
            <p v-if="store.actionMessage" class="action-banner ok">{{ store.actionMessage }}</p>
            <p v-if="store.actionError" class="action-banner err">{{ store.actionError }}</p>
          </div>
        </article>
      </div>

      <article class="detail-card history-card">
        <h3>历史响应过程（{{ history.length }} 条）</h3>
        <p class="box-tip">并发处置时只有最后一次有效提交会更新当前状态，但每一步响应记录都完整保留。</p>
        <ol v-if="history.length" class="history-timeline">
          <li v-for="record in history" :key="record.seq" class="history-item">
            <div class="history-head">
              <span class="history-seq">第 {{ record.seq }} 步</span>
              <span class="history-action">{{ record.action }}</span>
              <span class="history-flow">{{ record.fromStatus }} → {{ record.toStatus }}</span>
            </div>
            <div class="history-meta">
              <span>{{ record.operator }}</span>
              <span>{{ record.time }}</span>
            </div>
            <p v-if="record.note" class="history-note">{{ record.note }}</p>
          </li>
        </ol>
        <p v-else class="box-tip">事件尚未启动响应，暂无历史记录。</p>
      </article>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { REGION_FIELD, responseHistory } from '@/api/emergency-service'
import { DataReadError, subscribeStore } from '@/data/local-store'
import type { EntryRow } from '@/data/types'
import { useEmergencyWorkspaceStore } from '@/stores/emergency-workspace'
import { ROLE_OPTIONS, useSessionStore, type SessionRole } from '@/stores/session'

const route = useRoute()
const router = useRouter()
const store = useEmergencyWorkspaceStore()
const session = useSessionStore()

type DetailLoadState = 'loading' | 'ready' | 'error' | 'denied' | 'missing'

const loadState = ref<DetailLoadState>('loading')
const errorText = ref('')
const row = ref<EntryRow | null>(null)
const note = ref('')
const submitting = ref(false)

const infoFields = ['事件编号', '事件类型', '事发地点', REGION_FIELD, '危害等级', '接报时间', '处置时限']
const history = computed(() => (row.value ? responseHistory(row.value) : []))

const nextAction = computed<string | null>(() => {
  if (!row.value) return null
  switch (String(row.value.status)) {
    case '待响应':
      return '启动响应'
    case '响应中':
      return '制定方案'
    case '处置中':
      return '确认处置'
    default:
      return null
  }
})

function eventId(): number {
  return Number(route.params.id)
}

function load() {
  loadState.value = 'loading'
  errorText.value = ''
  try {
    const result = store.loadDetail(eventId())
    if (result.ok) {
      row.value = result.row
      loadState.value = 'ready'
    } else {
      row.value = null
      loadState.value = result.reason
      errorText.value = result.message
    }
  } catch (error) {
    row.value = null
    loadState.value = 'error'
    errorText.value =
      error instanceof DataReadError ? error.message : '应急事件详情读取失败，请稍后重试'
  }
}

async function submitAction(action: string, version: number) {
  submitting.value = true
  try {
    const result = await store.advance(eventId(), action, version, note.value)
    if (result.ok) {
      note.value = ''
    }
    load()
    return result
  } finally {
    submitting.value = false
  }
}

/**
 * 并发演示：故意携带一个更早的版本号提交。
 * 服务端版本校验会拒绝它，并把最后有效记录返回，页面刷新到最新状态。
 */
async function simulateStaleSubmit(action: string) {
  submitting.value = true
  try {
    const staleVersion = Math.max(0, Number(row.value?.version ?? 0) - 1)
    await store.advance(eventId(), action, staleVersion, note.value || '来自旧页面的并发提交')
    load()
  } finally {
    submitting.value = false
  }
}

function backToWorkbench() {
  // 返回时保留过滤条件与当前位置：state 已在 store/sessionStorage 中。
  router.push({ name: 'emergency' })
}

function onRoleChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value as SessionRole
  session.switchRole(value)
  load()
}

let unsubscribe: (() => void) | undefined
let stopRouteWatch: (() => void) | undefined

onMounted(() => {
  load()
  // 同一路由组件复用时（如 /emergency/2 切到 /emergency/1）按新 id 重新读取，避免停留在旧事件内容。
  stopRouteWatch = watch(
    () => route.params.id,
    () => load(),
  )
  // 其他标签页更新了处置状态：详情自动跟随到最后有效记录。
  unsubscribe = subscribeStore((reason) => {
    if (reason === 'cross-tab' && loadState.value === 'ready') {
      load()
    }
  })
})

onBeforeUnmount(() => {
  unsubscribe?.()
  stopRouteWatch?.()
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
.detail-grid {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 12px;
  margin-bottom: 12px;
}
.detail-card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 16px;
  margin-bottom: 12px;
}
.detail-card h3 {
  margin: 0 0 10px;
  font-size: 15px;
}
.info-list {
  margin: 0;
}
.info-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px dashed #e5e9f0;
  font-size: 13px;
}
.info-row:last-child {
  border-bottom: none;
}
.info-row dt {
  color: var(--muted);
  white-space: nowrap;
}
.info-row dd {
  margin: 0;
  text-align: right;
}
.current-status {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 8px;
}
.status-badge {
  background: #eef4ff;
  color: #1f4e9e;
  border-radius: 999px;
  padding: 3px 12px;
  font-size: 13px;
}
.version-text {
  color: var(--muted);
  font-size: 12px;
}
.plan-text {
  font-size: 13px;
  margin: 0 0 12px;
}
.action-box {
  border-top: 1px solid #e5e9f0;
  padding-top: 10px;
}
.action-box h4 {
  margin: 0 0 4px;
  font-size: 13px;
}
.box-tip {
  color: var(--muted);
  font-size: 12px;
  margin: 0 0 8px;
}
.action-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.note-input {
  font-size: 12px;
  color: var(--muted);
}
.note-input input {
  display: block;
  width: 100%;
  margin-top: 4px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.action-buttons {
  display: flex;
  gap: 8px;
}
.action-banner {
  font-size: 13px;
  border-radius: 6px;
  padding: 8px 10px;
  margin: 10px 0 0;
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
.history-card {
  margin-bottom: 0;
}
.history-timeline {
  list-style: none;
  margin: 0;
  padding: 0;
}
.history-item {
  position: relative;
  padding: 0 0 14px 18px;
  border-left: 2px solid #d8dee6;
  margin-left: 6px;
}
.history-item:last-child {
  border-left-color: transparent;
  padding-bottom: 0;
}
.history-item::before {
  content: '';
  position: absolute;
  left: -7px;
  top: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--brand);
}
.history-head {
  display: flex;
  gap: 8px;
  font-size: 13px;
  flex-wrap: wrap;
}
.history-seq {
  color: var(--muted);
}
.history-action {
  font-weight: 600;
}
.history-flow {
  color: #1f4e9e;
}
.history-meta {
  display: flex;
  gap: 10px;
  color: var(--muted);
  font-size: 12px;
  margin-top: 2px;
}
.history-note {
  margin: 4px 0 0;
  font-size: 13px;
}
.state-panel {
  background: #fff;
  border-radius: 8px;
  padding: 24px;
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
.denied-panel {
  border-color: #fedf89;
  background: #fffaeb;
}
.missing-panel {
  background: #fff;
}
@media (max-width: 900px) {
  .detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>
