<template>
  <section class="page" data-module="emergency-detail">
    <header class="page-head">
      <div>
        <h2>应急事件详情</h2>
        <p class="page-desc">
          当前状态只反映最后一次有效提交；下方响应过程保留完整历史，供随时回看。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">刷新最新状态</button>
        <button class="btn primary" type="button" @click="goBack">返回工作台</button>
      </div>
    </header>

    <div v-if="phase === 'loading'" class="state-panel state-loading">正在读取事件详情…</div>

    <div v-else-if="phase === 'error'" class="state-panel state-error" role="alert">
      <strong>事件详情读取失败</strong>
      <span>{{ errorMessage || '本地数据读取异常' }}</span>
      <button class="btn" type="button" @click="refresh">重试</button>
      <button class="btn ghost" type="button" @click="goBack">返回工作台</button>
    </div>

    <div v-else-if="phase === 'denied'" class="state-panel state-empty">
      <strong>没有找到该应急事件</strong>
      <span>编号 {{ eventId }} 的事件不存在，或不在「{{ session.operator }}」的辖区授权范围内。</span>
      <button class="btn" type="button" @click="goBack">返回工作台</button>
    </div>

    <template v-else-if="event">
      <p v-if="bannerMessage" class="inline-banner" :class="bannerError ? 'error-text' : 'ok-text'">
        {{ bannerMessage }}
      </p>

      <article class="detail-card">
        <header class="detail-head">
          <div>
            <h3>{{ event.事件编号 }}</h3>
            <p class="detail-sub">
              <span class="status-pill">{{ event.status }}</span>
              <span>辖区：{{ event.辖区 }}</span>
              <span>危害等级：{{ event.危害等级 }}</span>
            </p>
          </div>
          <span class="revision-tag">修订版本 #{{ event.修订版本 }}</span>
        </header>

        <dl class="detail-grid">
          <div v-for="field in infoFields" :key="field" class="detail-cell">
            <dt>{{ field }}</dt>
            <dd>{{ event[field] && event[field] !== '—' ? event[field] : '—' }}</dd>
          </div>
        </dl>

        <div class="action-box">
          <label class="note-field">
            <span>处置备注（可选）</span>
            <textarea v-model="note" rows="2" placeholder="记录本次处置要点，将写入响应过程"></textarea>
          </label>
          <div class="action-buttons">
            <button
              v-for="action in availableActions"
              :key="action"
              class="btn primary"
              type="button"
              :disabled="submitting"
              @click="runAction(action)"
            >
              {{ action }}
            </button>
            <span v-if="!availableActions.length" class="done-tip">事件已处置完毕，历史过程仍可在下方查看。</span>
          </div>
        </div>
      </article>

      <article class="history-card">
        <h3 class="history-head">响应过程（{{ event.响应过程.length }} 条）</h3>
        <ol class="history-list">
          <li v-for="(entry, index) in [...event.响应过程].reverse()" :key="index" class="history-item">
            <div class="history-dot" :class="{ latest: index === 0 }"></div>
            <div class="history-body">
              <div class="history-line">
                <strong>{{ entry.action }}</strong>
                <span class="history-flow">{{ entry.fromStatus }} → {{ entry.toStatus }}</span>
                <time>{{ entry.time }}</time>
              </div>
              <div class="history-meta">操作人：{{ entry.operator }}</div>
              <p v-if="entry.note" class="history-note">{{ entry.note }}</p>
            </div>
          </li>
        </ol>
      </article>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'

import { advanceStatus, getEvent } from '@/api/emergency-service'
import type { EmergencyEvent } from '@/data/types'
import { useEmergencyStore } from '@/stores/emergency'
import { useSessionStore } from '@/stores/session'

type Phase = 'loading' | 'ready' | 'denied' | 'error'

const route = useRoute()
const router = useRouter()
const store = useEmergencyStore()
const session = useSessionStore()

const infoFields = ['事件类型', '事发地点', '危害等级', '接报时间', '处置时限', '处置方案']

const event = ref<EmergencyEvent | null>(null)
const phase = ref<Phase>('loading')
const errorMessage = ref('')
const note = ref('')
const submitting = ref(false)
const bannerMessage = ref('')
const bannerError = ref(false)

const eventId = computed(() => Number(route.params.id))

const availableActions = computed<string[]>(() => {
  switch (event.value?.status) {
    case '待响应':
      return ['启动响应']
    case '响应中':
      return ['制定方案']
    case '处置中':
      return ['确认处置']
    default:
      return []
  }
})

function refresh() {
  phase.value = 'loading'
  errorMessage.value = ''
  try {
    const found = getEvent(eventId.value)
    if (!found) {
      // 不存在与越权统一呈现为“查不到”，不向越权人员泄露事件是否存在。
      phase.value = 'denied'
      event.value = null
      return
    }
    event.value = found
    phase.value = 'ready'
  } catch (error) {
    phase.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : '事件详情读取失败，请稍后重试'
  }
}

async function runAction(action: string) {
  if (!event.value || submitting.value) {
    return
  }
  submitting.value = true
  bannerMessage.value = ''
  // 带上当前修订版本：并发时只有基于最新数据的提交能生效。
  const result = advanceStatus(event.value.id, action, event.value.修订版本, note.value.trim())
  submitting.value = false
  bannerError.value = !result.ok
  bannerMessage.value = result.message
  if (result.ok && result.event) {
    event.value = result.event
    note.value = ''
    store.returnFromDetail()
    return
  }
  if (result.conflict && result.event) {
    // 他人的有效提交已经成为“当前状态”：本地切到最新版本，历史过程随之完整展示。
    event.value = result.event
  }
}

function goBack() {
  // 告知工作台要定位回本事件；过滤条件与滚动位置保留在 store 中。
  store.requestFocus(event.value?.id ?? null)
  router.push({ path: '/emergency' })
}

// 离开详情（含浏览器前进/后退）时都让工作台回到最新数据并定位当前事件。
onBeforeRouteLeave((to) => {
  if (to.path === '/emergency') {
    store.requestFocus(event.value?.id ?? null)
    store.returnFromDetail()
  }
})

function onEntriesChanged() {
  if (phase.value !== 'loading') {
    refresh()
  }
}

onMounted(() => {
  refresh()
  window.addEventListener('entries:changed', onEntriesChanged)
})

onBeforeUnmount(() => {
  window.removeEventListener('entries:changed', onEntriesChanged)
})
</script>

<style scoped>
.page-actions {
  display: flex;
  gap: 8px;
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
.state-loading {
  color: var(--muted);
}
.detail-card,
.history-card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px 18px;
  margin-bottom: 14px;
}
.detail-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  border-bottom: 1px solid var(--border);
  padding-bottom: 10px;
  margin-bottom: 12px;
}
.detail-head h3 {
  margin: 0 0 6px;
}
.detail-sub {
  margin: 0;
  display: flex;
  gap: 12px;
  align-items: center;
  color: var(--muted);
  font-size: 13px;
}
.status-pill {
  background: #e8f0fe;
  border-radius: 999px;
  padding: 1px 10px;
  font-size: 12px;
}
.revision-tag {
  font-size: 12px;
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px 8px;
}
.detail-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin: 0 0 14px;
}
.detail-cell dt {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 2px;
}
.detail-cell dd {
  margin: 0;
  font-size: 13px;
}
.action-box {
  border-top: 1px solid var(--border);
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.note-field span {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 4px;
}
.note-field textarea {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px;
  font: inherit;
  resize: vertical;
}
.action-buttons {
  display: flex;
  gap: 8px;
  align-items: center;
}
.done-tip {
  font-size: 12px;
  color: var(--muted);
}
.inline-banner {
  margin: 0 0 10px;
  font-size: 13px;
}
.ok-text {
  color: #17653a;
}
.history-head {
  margin: 0 0 10px;
  font-size: 14px;
}
.history-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.history-item {
  display: flex;
  gap: 10px;
  padding-bottom: 14px;
  position: relative;
}
.history-item:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 14px;
  bottom: 0;
  width: 2px;
  background: var(--border);
}
.history-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--border);
  margin-top: 5px;
  flex: none;
  z-index: 1;
}
.history-dot.latest {
  background: var(--brand);
}
.history-body {
  font-size: 13px;
}
.history-line {
  display: flex;
  gap: 10px;
  align-items: baseline;
  flex-wrap: wrap;
}
.history-flow {
  color: var(--muted);
  font-size: 12px;
}
.history-line time {
  color: var(--muted);
  font-size: 12px;
  margin-left: auto;
}
.history-meta {
  font-size: 12px;
  color: var(--muted);
  margin-top: 2px;
}
.history-note {
  margin: 4px 0 0;
  background: #f6f8fb;
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 12px;
}
</style>
