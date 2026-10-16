/**
 * deepseek-cost-hud 的状态契约。
 *
 * 这里声明的每个键都是 `$.state` 里一项被宿主保存的值，
 * 由 `hooks/register.tsx` 用 `atom({ plugin, key })` 引用。
 * `claude plugin validate` 会把 register.tsx 里引用的键逐个对照本文件校验。
 */

/** 一次 DeepSeek `GET /user/balance` 的结果（字符串字段已归一化为数字）。 */
export type Balance = {
  /** 账户是否可用（`is_available`）。 */
  isAvailable: boolean
  /** 币种，`CNY` 或 `USD`。 */
  currency: string
  /** 总余额。 */
  total: number
  /** 赠送余额。 */
  granted: number
  /** 充值余额。 */
  toppedUp: number
  /** 取到这份数据的时刻（`$.clock.now()` 的毫秒）。 */
  fetchedAt: number
}

/** 本会话累计的用量。 */
export type Usage = {
  /** 未命中缓存的输入 token（`turn.complete` 逐轮累加的真实计数）。 */
  inputTokens: number
  /** 生成的输出 token。 */
  outputTokens: number
  /** 由缓存直接供给的输入 token。 */
  cacheReadTokens: number
  /** 写入缓存的输入 token。 */
  cacheWriteTokens: number
  /** 计入统计的轮次数。 */
  turns: number
  /** 最近一次回答的模型 id。 */
  model: string
  /**
   * 本会话第一次成功拉到余额时的账户总额。
   * 与当前余额相减就是本会话**实测**花掉的钱，不是估算值。
   */
  startBalance: number | null
  /** 记录 `startBalance` 时的币种，用来判断两次读数能不能直接相减。 */
  startCurrency: string
  /**
   * 逐轮累加的**估算**花费，单位见 `priceCurrency`。
   * 每一轮按该轮发生时刻处于高峰还是错峰选取单价，所以跨时段的长会话会自动
   * 把两种价都算进去。与 `startBalance` 的差额对照即可看出估算准不准。
   */
  estimatedCost: number
}

/** 上一次刷新失败的原因；`null` 表示正常。 */
export type HudError = string | null

declare module 'claude-code' {
  interface PluginState {
    'deepseek-cost-hud': {
      balance: Balance | null
      usage: Usage
      isHidden: boolean
      error: HudError
    }
  }
}
