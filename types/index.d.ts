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
  /**
   * 逐轮累加的**估算**花费，单位见 `priceCurrency`。
   * 每一轮按该轮发生时刻处于高峰还是错峰选取单价，所以跨时段的长会话会自动
   * 把两种价都算进去。
   *
   * 只保留估算值是有意的：余额差额看似能给出「实测」花费，但余额是账户级的、
   * 不带归属信息，别的会话或程序消耗同一账户时也会从差额里掉下来，于是被算到
   * 本会话头上。token 数才是按会话上报的，能正确归属。
   */
  estimatedCost: number
}

/** 上一次刷新失败的原因；`null` 表示正常。 */
export type HudError = string | null

// ── 抽奖 ────────────────────────────────────────────────────────────

/** 五个档位，从高概率到低概率。 */
export type TierId = 'common' | 'rare' | 'uncommon' | 'epic' | 'legendary'

/**
 * 抽奖的全局账本，存在 `$.store` 里 —— 所以它跨会话、跨热重载共享：
 * 任意会话里花掉的 token 攒下的次数，都能在任意会话里抽。
 *
 * 注意 `$.store` 没有 CAS（只有 `$.state` 有 `ifVersion`），所以这里是
 * 读-改-写、最后写入者胜出。写入方只有「每轮自动累加」和「用户手动抽一次」
 * 两类，都是人速节奏，撞在同一毫秒的概率可以忽略。
 */
export type GachaRecord = {
  /** 全局累计的估算花费（元），逐轮累加 */
  spent: number
  /** 已经抽过多少次 */
  drawn: number
  /** 物品 id → 抽到过几次 */
  owned: Record<string, number>
}

/**
 * 一次开奖的过程状态，只活在 `$.state` 里，给面板渲染用。
 * 持久的东西在 `GachaRecord`，这里只放"这一次开奖演到哪了"。
 */
export type Spin = {
  phase: 'idle' | 'spinning' | 'revealed'
  /**
   * 这次抽奖在转盘上生成的六个色块各是什么档位。**按概率生成**，所以大概率
   * 一片普通（蓝）；指针在六块上等概率落点，落在哪块就取哪块。
   */
  slots: TierId[]
  /** 指针落在第几块（0 起） */
  winner: number
  /** 本次抽到的档位（= slots[winner]） */
  tier: TierId | null
  /** 本次抽到的物品 id */
  itemId: string | null
  /** 动画帧序号 */
  frame: number
  /** 抽完这一次之后还剩几次 —— 面板上"再来一次"按钮要用，避免每帧去读 store */
  pending: number
}

declare module 'claude-code' {
  interface PluginState {
    'deepseek-cost-hud': {
      balance: Balance | null
      usage: Usage
      isHidden: boolean
      error: HudError
      /**
       * 当前会话的模型 id（`$.session.model()`，每轮再用该轮的模型校正）。
       * 非 DeepSeek 的模型既不计价也不显示横条。
       */
      model: string
      /** 抽奖动画的当前状态 */
      spin: Spin
      /** 设置 Key 的面板上那行提示（空串 = 还没提交过） */
      keyMsg: string
      /**
       * **本机累计**估算花费（元）—— 所有会话加起来，和抽奖次数的口径一致。
       * 进度条用它，所以"每满 ¥1 归零"和"每满 ¥1 得一次"说的是同一件事。
       * 它是账本的镜像（账本在 `$.fs` 的文件里），`$.state` 只为了渲染便宜。
       */
      machineSpent: number
    }
  }
}
