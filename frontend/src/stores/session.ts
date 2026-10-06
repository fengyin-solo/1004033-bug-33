import { defineStore } from 'pinia'

export type SessionRole = 'admin' | 'east' | 'south'

/** 各角色能查看的区域；管理员为 null 表示不受区域限制。 */
const ROLE_REGIONS: Record<SessionRole, string[] | null> = {
  admin: null,
  east: ['城东区'],
  south: ['城南区', '高新区'],
}

const ROLE_OPERATOR: Record<SessionRole, string> = {
  admin: '值班管理员',
  east: '城东值班员',
  south: '城南值班员',
}

const ROLE_LABEL: Record<SessionRole, string> = {
  admin: '全市管理员（全部区域）',
  east: '城东值班员（仅城东区）',
  south: '城南值班员（城南区、高新区）',
}

export const ROLE_OPTIONS: { value: SessionRole; label: string }[] = [
  { value: 'admin', label: ROLE_LABEL.admin },
  { value: 'east', label: ROLE_LABEL.east },
  { value: 'south', label: ROLE_LABEL.south },
]

export const useSessionStore = defineStore('session', {
  state: () => ({
    role: 'admin' as SessionRole,
    operator: ROLE_OPERATOR.admin,
    shiftLabel: '白班 08:00-20:00',
    scope: '城市地下管网巡检养护管理系统',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    /** 可访问区域列表；null 表示全部区域。 */
    regions(): string[] | null {
      return ROLE_REGIONS[this.role]
    },
    roleLabel(): string {
      return ROLE_LABEL[this.role]
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    switchRole(role: SessionRole) {
      this.role = role
      this.operator = ROLE_OPERATOR[role]
    },
    /** 某条记录的区域是否在当前人员权限内。 */
    canAccessRegion(region: string): boolean {
      const allowed = ROLE_REGIONS[this.role]
      return allowed === null || allowed.includes(region)
    },
  },
})
