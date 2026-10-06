import { defineStore } from 'pinia'

// 全部辖区：登记的应急事件都落在其中一个片区，越权过滤在数据层兜底。
export const REGIONS = ['城东片区', '城西片区', '城南片区', '城北片区'] as const
export type Region = (typeof REGIONS)[number]

type Operator = {
  name: string
  // 可查看的辖区；['*'] 表示指挥中心，可查看全部辖区。
  regions: string[]
}

// 演示账号：值班员只看得到自己片区，指挥中心看得到全城。
const OPERATORS: Record<string, Operator> = {
  值班管理员: { name: '值班管理员', regions: ['*'] },
  城东值班员: { name: '城东值班员', regions: ['城东片区'] },
  城西值班员: { name: '城西值班员', regions: ['城西片区'] },
  城南值班员: { name: '城南值班员', regions: ['城南片区'] },
  城北值班员: { name: '城北值班员', regions: ['城北片区'] },
}

export const OPERATOR_NAMES = Object.keys(OPERATORS)

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员' as string,
    shiftLabel: '白班 08:00-20:00',
    scope: '城市地下管网巡检养护管理系统',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    // 当前账号允许查看的辖区；未知账号按无权限处理（看不到任何事件），而不是放行全部。
    allowedRegions(state): Region[] {
      const account = OPERATORS[state.operator]
      if (!account) {
        return []
      }
      return account.regions.includes('*')
        ? [...REGIONS]
        : (account.regions.filter((region) =>
            (REGIONS as readonly string[]).includes(region),
          ) as Region[])
    },
    isCityWide(): boolean {
      const account = OPERATORS[this.operator]
      return Boolean(account && account.regions.includes('*'))
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setOperator(name: string) {
      this.operator = name
    },
    // 数据层兜底：辖区不在授权范围内的事件一律不可见，过滤条件无法绕过。
    canAccessRegion(region: string): boolean {
      const account = OPERATORS[this.operator]
      if (!account) {
        return false
      }
      return account.regions.includes('*') || account.regions.includes(region)
    },
  },
})
