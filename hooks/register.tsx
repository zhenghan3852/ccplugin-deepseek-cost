/**
 * deepseek-cost-hud —— 同时显示在 Claude Code 终端与 Claude Desktop 上的
 * DeepSeek 余额 / 用量 HUD。
 *
 * 为什么这一份代码能同时跑在两个地方：
 *   它不是 statusLine 命令，而是引擎里的函数钩子模块。引擎在 CLI 和 Desktop
 *   两个宿主里都加载它，`$` 这一个接口在两处都成立 —— 网络走宿主（`$.http`）、
 *   持久化走宿主（`$.store`）、界面走宿主（`$.ui`）。同一份逻辑因而天然跨端。
 *
 * 画在哪里：
 *   `ui.render` 钩在 `AbovePrompt` 上。这个组件按引擎的说明「只在 terminal 和
 *   desktop 两个 surface 上渲染」，正是跨端所需的那一个：终端里它落在输入框上方，
 *   Desktop 里落成同一位置的横条。整条 HUD 只画在这一处 —— 不再往状态行
 *   （`$.ui.status`）顶单行摘要，因为 Desktop 里那会在输入框下面再冒出一行。
 *
 * 数据从哪来 —— 这几件事的确定性不一样，别混为一谈：
 *
 *   余额        `GET /user/balance`，用 API key 真实拉取。权威值，不是估算。
 *
 *   token 数    每轮 `turn.complete` 带回来的 usage 逐轮累加，是 API 报告的真实
 *               计数。DeepSeek 官方 API Reference 只有 Chat Completions、
 *               Responses、FIM、Lists Models、Get User Balance 和 Files，
 *               **没有**用量或账单查询接口，所以「用量」只能这样从响应里攒。
 *
 *   花费        只能估算，即 token 数 × 单价。
 *               余额差额看着像「实测」，但不能当会话消耗用：余额是账户级的、
 *               不带归属信息，同一账户下别的会话或程序花掉的钱同样会从差额里
 *               掉下来，于是被算到本会话头上 —— 同时开两个会话就能算出两倍的
 *               钱。token 数才是按会话上报的，能正确归属，所以会话花费一律以
 *               估算为准。每一轮按该轮发生时刻选单价，跨高峰/错峰的长会话会
 *               自动把两种价都算进去。
 */

import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  PluginOptions,
  Register,
  RenderElement,
  RenderNode,
} from 'claude-code'

import type { Balance, GachaRecord, HudError, Spin, TierId, Usage } from '../types'
import { ITEM_BY_ID, ITEMS, ITEMS_BY_TIER, rollItem, TIER_BY_ID, TIERS } from './gacha-items'
import { encodeRow, wheelGrid, WHEEL_FRAMES, WHEEL_TICK_MS } from './gacha-wheel'

// ── 状态引用 ────────────────────────────────────────────────────────
// plugin / key 必须是源码里的字面量，`claude plugin validate` 会把它们
// 逐个对照 types/index.d.ts 的契约校验，所以这里不抽常量。

const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 0,
  estimatedCost: 0,
}

const balanceAtom = atom({ plugin: 'deepseek-cost-hud', key: 'balance' } as const, null)
const usageAtom = atom({ plugin: 'deepseek-cost-hud', key: 'usage' } as const, EMPTY_USAGE)
const hiddenAtom = atom({ plugin: 'deepseek-cost-hud', key: 'isHidden' } as const, false)
const errorAtom = atom({ plugin: 'deepseek-cost-hud', key: 'error' } as const, null)
const modelAtom = atom({ plugin: 'deepseek-cost-hud', key: 'model' } as const, '')

// ── 配置 ────────────────────────────────────────────────────────────

type Settings = {
  apiKey: string
  apiBase: string
  refreshMs: number
  showCycle: boolean
  showUsage: boolean
  showBalance: boolean
  priceInput: number
  priceCacheRead: number
  priceOutput: number
  priceCurrency: string
  priceSymbol: string
  offPeakRatio: number
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function asNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function readSettings(options: PluginOptions): Settings {
  const currency = asString(options?.priceCurrency, 'CNY')
  const discount = Math.min(100, Math.max(0, asNumber(options?.offPeakDiscount, 50)))
  return {
    apiKey: asString(options?.apiKey),
    apiBase: asString(options?.balanceApiBase, 'https://api.deepseek.com').replace(/\/+$/, ''),
    refreshMs: Math.max(5, asNumber(options?.refreshSeconds, 60)) * 1000,
    showCycle: asBoolean(options?.showCycle, true),
    showUsage: asBoolean(options?.showUsage, true),
    showBalance: asBoolean(options?.showBalance, true),
    priceInput: asNumber(options?.priceInput, 2),
    priceCacheRead: asNumber(options?.priceCacheRead, 0.04),
    priceOutput: asNumber(options?.priceOutput, 8),
    priceCurrency: currency,
    priceSymbol: currency === 'CNY' ? '¥' : '$',
    // 官方口径：错峰价 = 高峰价的一半
    offPeakRatio: 1 - discount / 100,
  }
}

// ── 计价 ────────────────────────────────────────────────────────────
//
// DeepSeek 官方价目把一天切成高峰和错峰两档：高峰是 UTC 周一至周五的
// 01:00-04:00 与 06:00-10:00（北京时间 09:00-12:00、14:00-18:00），
// 其余时段 —— 包括整个周末 —— 都算错峰，错峰价是高峰价的一半。
//
// 已知不足：官方口径里「中国法定节假日全天算错峰」，而这里只判了周末，
// 没有节假日数据表。所以在法定节假日当天，估算值会偏高一点。

function isPeak(atMs: number): boolean {
  const at = new Date(atMs)
  const day = at.getUTCDay()
  if (day === 0 || day === 6) return false
  const hour = at.getUTCHours() + at.getUTCMinutes() / 60
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10)
}

/**
 * 按模型计价。表里是官方**人民币高峰价**（每百万 token），错峰由
 * `offPeakDiscount` 折半。只列这两个模型 —— 官方在售的就是它们两档；
 * 遇到别的模型（包括别的 deepseek-* 变体）就退回配置里那三个兜底单价。
 */
type ModelPrices = { input: number; cacheRead: number; output: number }

const MODEL_PRICES: Record<string, ModelPrices> = {
  'deepseek-flash': { input: 2, cacheRead: 0.04, output: 8 },
  'deepseek-v4-pro': { input: 9, cacheRead: 0.3, output: 27 },
}

function peakPricesFor(model: string, cfg: Settings): ModelPrices {
  return MODEL_PRICES[model] ?? {
    input: cfg.priceInput,
    cacheRead: cfg.priceCacheRead,
    output: cfg.priceOutput,
  }
}

/**
 * 是不是 DeepSeek 的模型。非 DeepSeek（走别的网关时会出现 glm-5.3 这类）既不
 * 计价也不显示横条 —— 拿 DeepSeek 的价目折算别的模型没有意义。
 */
function isDeepSeekModel(model: string): boolean {
  return /^deepseek/i.test(model.trim())
}

type Tokens = Pick<Usage, 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>

/** 一组 token 数按某套单价、某一刻的高低谷折算成钱。 */
function costOf(tokens: Tokens, cfg: Settings, peak: ModelPrices, atMs: number): number {
  const factor = isPeak(atMs) ? 1 : cfg.offPeakRatio
  // 写入缓存的输入按未命中价计费
  return (
    (((tokens.inputTokens + tokens.cacheWriteTokens) / 1e6) * peak.input +
      (tokens.cacheReadTokens / 1e6) * peak.cacheRead +
      (tokens.outputTokens / 1e6) * peak.output) *
    factor
  )
}

// ── DeepSeek /user/balance 的响应形状 ───────────────────────────────

type BalancePayload = {
  is_available?: boolean
  balance_infos?: {
    currency?: string
    total_balance?: string
    granted_balance?: string
    topped_up_balance?: string
  }[]
}

function toNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ── 纯函数:格式化 ───────────────────────────────────────────────────

/** 12345 → "12.3k"，1048576 → "1.0M" */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(Math.round(n))
}

/** 10 格进度条 */
function renderBar(percent: number, width = 10): string {
  const p = Math.max(0, Math.min(100, percent))
  const filled = Math.round((p / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

/** 进度条每走满这么多就归零重来，单位与 priceCurrency 一致。 */
const CYCLE_BUDGET = 1

/** 本会话估算花费在当前这一元里的位置（百分比）。每满一轮归零，所以只看余数。 */
function cyclePercent(cost: number, budget: number): number {
  if (!(budget > 0)) return 0
  return ((cost % budget) / budget) * 100
}

/** 余额越低越危险 */
function balanceLevel(balance: Balance | null): 'success' | 'warning' | 'error' | 'inactive' {
  if (!balance) return 'inactive'
  if (!balance.isAvailable || balance.total <= 0) return 'error'
  if (balance.total < 10) return 'warning'
  return 'success'
}

function currencySymbol(currency: string): string {
  return currency === 'USD' ? '$' : '¥'
}

/** 把金额收成一行：40.36 / 0.02 / <0.01 */
function money(amount: number, symbol: string): string {
  if (amount > 0 && amount < 0.01) return `<${symbol}0.01`
  return `${symbol}${amount.toFixed(2)}`
}

/** 估算要保留更多位才有意义，分以下的东西两位小数会全被抹平 */
function moneyFine(amount: number, symbol: string): string {
  if (amount > 0 && amount < 0.01) return `${symbol}${amount.toFixed(4)}`
  return `${symbol}${amount.toFixed(2)}`
}

function shortError(error: HudError): string {
  if (error === 'no-key') return '未配置 Key'
  if (!error) return ''
  return error.length > 24 ? `${error.slice(0, 21)}...` : error
}

function cacheHitRate(usage: Usage): number | null {
  const billedInput = usage.inputTokens + usage.cacheWriteTokens + usage.cacheReadTokens
  if (billedInput <= 0) return null
  return usage.cacheReadTokens / billedInput
}

// ── 插件主体 ────────────────────────────────────────────────────────

// 引擎会先静态扫描模块用了哪些接口方法，才决定加载它。扫描要求 `$` 只递给
// 本文件**顶层**声明的函数 —— 递给嵌套函数就扫不到，整个模块被拒，而且是
// 静默的：会话照常开始，不报错，只是这个 mod 一个钩子都没注册。所以下面四个
// 用到 `$` 的函数必须留在顶层，不能挪进 register 里。
//
// 定时器句柄与并发闸门。模块级变量在热重载后会丢失，所以只放真正属于
// 这次运行时载入的东西；显示用的值一律走 $.state。
let timer: { cancel: () => void } | null = null
let isFetching = false

/**
 * 按优先级找 API Key：
 * 插件配置 → 插件自带存储（/deepseek-key 存的） → DEEPSEEK_API_KEY → ANTHROPIC_AUTH_TOKEN
 */
async function resolveKey($: EngineInterface, cfg: Settings): Promise<string> {
  if (cfg.apiKey) return cfg.apiKey

  const stored = await $.store.get('apiKey')
  if (typeof stored === 'string' && stored.trim()) return stored.trim()

  const direct = await $.env.get('DEEPSEEK_API_KEY')
  if (direct?.trim()) return direct.trim()

  // 用 cc-switch 之类把 Claude Code 路由到 DeepSeek 时，key 落在 ANTHROPIC_AUTH_TOKEN
  const routed = await $.env.get('ANTHROPIC_AUTH_TOKEN')
  if (routed?.trim()) return routed.trim()

  return ''
}

/** 拉一次余额并写进状态；失败只记原因，不抛。 */
async function refreshBalance($: EngineInterface, cfg: Settings): Promise<void> {
  if (isFetching) return
  isFetching = true
  try {
    const key = await resolveKey($, cfg)
    if (!key) {
      await update($, errorAtom, () => 'no-key')
      return
    }

    const res = await $.http.fetch(`${cfg.apiBase}/user/balance`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${key}`,
      },
    })

    if (!res.ok) {
      await update($, errorAtom, () => `HTTP ${res.status}`)
      return
    }

    const payload = JSON.parse(res.text) as BalancePayload
    const info = payload.balance_infos?.[0]
    const next: Balance = {
      isAvailable: payload.is_available === true,
      currency: info?.currency ?? 'CNY',
      total: toNumber(info?.total_balance),
      granted: toNumber(info?.granted_balance),
      toppedUp: toNumber(info?.topped_up_balance),
      fetchedAt: await $.clock.now(),
    }

    await update($, balanceAtom, () => next)
    await update($, errorAtom, () => null)
    // 存一份，下次会话首屏就能立刻显示真实余额，不用等网络
    await $.store.set('balance', next)
  } catch (err) {
    await update($, errorAtom, () => messageOf(err))
  } finally {
    isFetching = false
  }
}

/**
 * 回放上一次确认过的上游模型（存在 `$.store`，跨会话）。
 *
 * **为什么不用 `$.session.model()`**：它给的是映射**前**的客户端模型名 ——
 * 走 cc-switch 之类网关时拿到的是 `claude-haiku-4-5[1m]` 这种，拿去判断
 * "是不是 DeepSeek"必然判错。上游真名只有每轮 `turn.complete` 的响应里才有，
 * 所以这里只回放上次的结论；新机器上第一次跑仍要等第一轮回答完。
 */
async function restoreModel($: EngineInterface): Promise<void> {
  const saved = await $.store.get('lastModel')
  if (typeof saved === 'string' && saved.trim()) {
    await update($, modelAtom, () => saved.trim())
  }
}

/** `/deepseek-cost` 的完整报告：本会话用量明细 + 按单价折算出来的花费。 */
async function costReport($: EngineInterface, cfg: Settings): Promise<string> {
  const balance = await read($, balanceAtom)
  const usage = await read($, usageAtom)
  const rows: string[] = []

  if (balance) {
    rows.push(`余额        ${money(balance.total, currencySymbol(balance.currency))}（充值 ${balance.toppedUp.toFixed(2)} + 赠送 ${balance.granted.toFixed(2)}）`)
  } else {
    rows.push('余额        尚未取到（用 /deepseek-key 配 Key，或设 DEEPSEEK_API_KEY）')
  }

  // 花费是按模型折算的，所以先把「按哪个模型、哪套价」交代清楚。
  // 注意要分清"还不知道"和"确认不是 DeepSeek"：前一种是本会话还没走完一轮，
  // 说成后者就是错的 —— 上游真名只有每轮的响应里才有。
  const model = await read($, modelAtom)
  const known = MODEL_PRICES[model]
  if (!model) {
    rows.push('模型        还不知道（本会话还没走完一轮，模型在第一次回答后确定）')
  } else if (!isDeepSeekModel(model)) {
    rows.push(`模型        ${model}   （非 DeepSeek 模型：不计价，横条也不显示）`)
  } else if (known) {
    rows.push(
      `模型        ${model}   （内置高峰价 ${known.input} / ${known.cacheRead} / ${known.output} 元每百万 token，错峰减半）`,
    )
  } else {
    rows.push(`模型        ${model}   （不在内置价目表里，用配置里的兜底单价）`)
  }

  if (usage.turns === 0) {
    rows.push('本会话      还没有走完一轮，暂无用量')
    return rows.join('\n')
  }

  // 会话花费只有估算这一个口径：余额差额是账户级的，别的会话花掉的钱同样会从
  // 差额里掉下来，算不到本会话头上。
  const percent = cyclePercent(usage.estimatedCost, CYCLE_BUDGET)
  rows.push(
    `本会话估算  ${moneyFine(usage.estimatedCost, cfg.priceSymbol)}   （进度条 ${percent.toFixed(1)}%，每满 ${cfg.priceSymbol}${CYCLE_BUDGET} 得一次抽奖）`,
  )

  const hitRate = cacheHitRate(usage)
  rows.push(
    `token       ↑${compact(usage.inputTokens)}（缓存命中 ${compact(usage.cacheReadTokens)} / 未命中 ${compact(usage.inputTokens + usage.cacheWriteTokens)}）  ↓${compact(usage.outputTokens)}   共 ${usage.turns} 轮`,
  )
  if (hitRate !== null) {
    rows.push(`缓存命中率  ${(hitRate * 100).toFixed(1)}%`)
  }
  rows.push(`当前计价    ${isPeak(Date.now()) ? '高峰' : `错峰（高峰价的 ${(cfg.offPeakRatio * 100).toFixed(0)}%）`}`)

  return rows.join('\n')
}

// ── 抽奖与图鉴 ──────────────────────────────────────────────────────
//
// 次数与图鉴存在 `$.store` 里，所以跨会话共享 —— 任意会话里花掉的 token 攒下
// 的次数，都能在任意会话里抽。开奖的**过程**状态才放 `$.state`。

const EMPTY_SPIN: Spin = { phase: 'idle', tier: null, itemId: null, frame: 0, pending: 0 }

const spinAtom = atom({ plugin: 'deepseek-cost-hud', key: 'spin' } as const, EMPTY_SPIN)

/** 读全局账本。形状不对就当空账本 —— 它跨版本持久化，不能假定一定合法。 */
async function readGacha($: EngineInterface): Promise<GachaRecord> {
  const raw = (await $.store.get('gacha')) as Partial<GachaRecord> | undefined
  return {
    spent: typeof raw?.spent === 'number' && Number.isFinite(raw.spent) ? raw.spent : 0,
    drawn: typeof raw?.drawn === 'number' && Number.isFinite(raw.drawn) ? raw.drawn : 0,
    owned: raw?.owned && typeof raw.owned === 'object' ? { ...raw.owned } : {},
  }
}

/** 每满 ¥1 一次，减掉已经抽掉的。 */
function pendingDraws(record: GachaRecord): number {
  return Math.max(0, Math.floor(record.spent) - record.drawn)
}

/** 某一档已收集的物品，排成一行。 */
function ownedLine(record: GachaRecord, tier: TierId): string {
  return ITEMS_BY_TIER[tier]
    .filter((item) => (record.owned[item.id] ?? 0) > 0)
    .map((item) => `${item.name}×${record.owned[item.id] ?? 1}`)
    .join('  ')
}

/** `/deepseek-dex` 的正文：各档收集进度 + 已抽到的物品。 */
function dexLines(record: GachaRecord): string[] {
  const collected = ITEMS.filter((item) => (record.owned[item.id] ?? 0) > 0).length
  const rows = [
    `待抽        ${pendingDraws(record)} 次   （累计花费 ¥${record.spent.toFixed(2)}，每满 ¥1 得一次）`,
    `已抽        ${record.drawn} 次，图鉴 ${collected}/${ITEMS.length}`,
    '',
  ]
  for (const tier of TIERS) {
    const pool = ITEMS_BY_TIER[tier.id]
    const owned = pool.filter((item) => (record.owned[item.id] ?? 0) > 0)
    rows.push(`${tier.name}（${tier.value}）  ${owned.length}/${pool.length}`)
    if (owned.length > 0) rows.push(`  ${ownedLine(record, tier.id)}`)
  }
  return rows
}

// ── 像素转盘 ────────────────────────────────────────────────────────
//
// 几何与配色在 gacha-wheel.ts（纯函数，可单测），这里只管把它接上界面和时钟。
// 画法上有一点是硬约束：引擎的渲染元素里只有 Box/Text 在终端和 Desktop 上
// **都**支持 backgroundColor，所以转盘只能用它们拼 —— Raster 只有终端、
// Svg 只有 Desktop，单实现都用不了。

const GACHA_PANE = 'deepseek-gacha'

let spinTimer: { cancel: () => void } | null = null

/** 推进一帧；走完就停在开奖态并停表。 */
async function advanceSpin($: EngineInterface): Promise<void> {
  const spin = await read($, spinAtom)
  if (spin.phase !== 'spinning') return
  const frame = spin.frame + 1
  if (frame >= WHEEL_FRAMES) {
    spinTimer?.cancel()
    spinTimer = null
    await update(
      $,
      spinAtom,
      (prev): Spin => ({ ...prev, phase: 'revealed', frame: WHEEL_FRAMES - 1 }),
    )
  } else {
    await update($, spinAtom, (prev): Spin => ({ ...prev, frame }))
  }
}

/**
 * 抽一次并起动画；返回交给命令说的那一句话。
 *
 * **先定结果、先落库，再谈动画**：面板放不下或动画播不出来，次数照样扣了、
 * 东西照样到手了 —— 画面只是表现层，不参与决定。
 */
async function startDraw($: EngineInterface): Promise<string> {
  const record = await readGacha($)
  const pending = pendingDraws(record)

  if (pending <= 0) {
    return `还没有可抽的次数：累计花费 ¥${record.spent.toFixed(2)}，每满 ¥1 得一次。`
  }

  const { tier, item } = rollItem(Math.random)
  await $.store.set('gacha', {
    spent: record.spent,
    drawn: record.drawn + 1,
    owned: { ...record.owned, [item.id]: (record.owned[item.id] ?? 0) + 1 },
  })

  await update($, spinAtom, () => ({
    phase: 'spinning' as const,
    tier,
    itemId: item.id,
    frame: 0,
    pending: pending - 1,
  }))

  const headline = `${TIER_BY_ID[tier].name} · ${item.name}`
  const opened = await $.ui.open({
    id: GACHA_PANE,
    title: '抽奖',
    focus: true,
    closeOnEscape: true,
  })

  if (!opened.isPlaced) {
    // 终端太窄之类：面板没地方放，就不演了，直接把结果说出来
    await update($, spinAtom, (prev): Spin => ({ ...prev, phase: 'revealed' }))
    return `抽到了：${headline}（面板放不下，没播动画）`
  }

  spinTimer?.cancel()
  spinTimer = $.clock.every(WHEEL_TICK_MS, () => void advanceSpin($))
  return `抽到了：${headline}`
}

export const register: Register = (on, options) => {
  const cfg = readSettings(options)

  // ── 会话开始：铺首屏、注册命令、拉余额、起定时器 ──────────────────

  on('session.start', async ($, e, next) => {
    // 注意：本钩子在热重载后会再次触发，所以**不能**在这里重置用量 ——
    // 那会把已经攒下的数字清零。会话切换只在 session.end 里处理。

    // 1) 先用上次会话存下的余额铺首屏，别让人盯着空白等网络
    const cached = await $.store.get('balance')
    if (cached && typeof cached === 'object') {
      const restored = cached as Balance
      if (typeof restored.total === 'number' && typeof restored.currency === 'string') {
        await update($, balanceAtom, () => restored)
      }
    }

    // 2) 命令。重复注册同名命令是替换而非叠加，所以热重载后再走一遍也没事。
    await $.command.register({
      name: 'deepseek-hud',
      description: '显示 / 隐藏 DeepSeek 余额与用量横条',
    })
    await $.command.register({
      name: 'deepseek-cost',
      description: '列出本会话用量明细与按单价折算出来的花费',
    })
    await $.command.register({
      name: 'deepseek-refresh',
      description: '立刻刷新 DeepSeek 余额',
    })
    await $.command.register({
      name: 'deepseek-key',
      description: '保存 DeepSeek API Key（存进插件存储）',
      argumentHint: 'sk-...',
    })
    await $.command.register({
      name: 'deepseek-draw',
      description: '用攒下的次数抽一次奖（每花满 ¥1 得一次）',
    })
    await $.command.register({
      name: 'deepseek-dex',
      description: '看抽奖图鉴：各档收集进度与已抽到的物品',
    })

    // 3) 拉一次真实余额（有缓存也拉，让数字尽快变准），再回放上次确认的模型
    await refreshBalance($, cfg)
    await restoreModel($)

    // 4) 起定时刷新。定时器归引擎的时钟管，钩子这一趟结束也照样跑，
    //    直到 cancel() 或模块被重载（重载会把上一个环境的定时器一并丢掉，
    //    所以这里 cancel 只是防御性的）。
    timer?.cancel()
    timer = $.clock.every(cfg.refreshMs, () => {
      void refreshBalance($, cfg)
    })

    return next(e)
  })

  // ── 会话结束 ──────────────────────────────────────────────────────
  // `/clear`、`/resume`、`/branch` 都只触发 session.end，不会再来一次
  // session.start（见官方事件表），所以新会话的开始必须在这里收尾。

  on('session.end', async ($, e, next) => {
    timer?.cancel()
    timer = null

    // 这三种意味着接下来是一条新对话，本会话的用量不该带过去
    if (e.reason === 'clear' || e.reason === 'resume' || e.reason === 'logout') {
      await update($, usageAtom, () => EMPTY_USAGE)
    }

    return next(e)
  })

  // ── 逐轮累加用量 ──────────────────────────────────────────────────
  // `turn.complete` 带的是「本轮真实请求的 token 数」之和，把整条会话加起来
  // 就是本会话的真实用量。子 agent 的轮次也会走到这里 —— 那同样是真花掉的钱。
  //
  // 估算的那一份在这里就地结算：单价按这一轮的**模型**选，再按该轮发生的时刻
  // 选高峰/错峰，于是混合模型、跨时段的会话都能各算各的。非 DeepSeek 的轮次
  // 直接不进账 —— 横条讲的是 DeepSeek 的花费。

  on('turn.complete', async ($, e, next) => {
    const used = e.usage
    if (used) {
      // 这一轮是谁在跑：优先用响应里报的模型，没有就退回已记下的
      const known = await read($, modelAtom)
      const model = (used.model || known).trim()
      if (model && model !== known) {
        await update($, modelAtom, () => model)
        // 记下来，下次开新会话就能立刻判断，不用等第一轮回答
        await $.store.set('lastModel', model)
      }

      if (isDeepSeekModel(model)) {
        const now = await $.clock.now()
        const tokens: Tokens = {
          inputTokens: used.input_tokens ?? 0,
          outputTokens: used.output_tokens ?? 0,
          cacheReadTokens: used.cache_read_input_tokens ?? 0,
          cacheWriteTokens: used.cache_creation_input_tokens ?? 0,
        }
        const turnCost = costOf(tokens, cfg, peakPricesFor(model, cfg), now)

        // 这一轮的花费也累加进全局账本 —— 每满 ¥1 就多一次抽奖机会。
        // 账本在 $.store（宿主级），所以任意会话花的钱攒的次数都能在任意会话里抽。
        const gacha = await readGacha($)
        await $.store.set('gacha', { ...gacha, spent: gacha.spent + turnCost })

        await update($, usageAtom, prev => ({
          ...prev,
          inputTokens: prev.inputTokens + tokens.inputTokens,
          outputTokens: prev.outputTokens + tokens.outputTokens,
          cacheReadTokens: prev.cacheReadTokens + tokens.cacheReadTokens,
          cacheWriteTokens: prev.cacheWriteTokens + tokens.cacheWriteTokens,
          turns: prev.turns + 1,
          estimatedCost: prev.estimatedCost + turnCost,
        }))
      }
    }

    return next(e)
  })

  // ── 命令 ──────────────────────────────────────────────────────────

  on('command.run', { command: 'deepseek-hud' }, async ($, e) => {
    const hidden = await read($, hiddenAtom)
    await update($, hiddenAtom, () => !hidden)
    return { text: hidden ? 'DeepSeek HUD 已显示。' : 'DeepSeek HUD 已隐藏。' }
  })

  on('command.run', { command: 'deepseek-cost' }, async $ => ({ text: await costReport($, cfg) }))

  on('command.run', { command: 'deepseek-refresh' }, async ($, e) => {
    await refreshBalance($, cfg)
    const error = await read($, errorAtom)
    const balance = await read($, balanceAtom)
    if (error) return { text: `刷新失败：${shortError(error)}` }
    if (!balance) return { text: '还没有余额数据。' }
    return { text: `余额 ${money(balance.total, currencySymbol(balance.currency))}` }
  })

  on('command.run', { command: 'deepseek-key' }, async ($, e) => {
    const key = e.args.trim()
    if (!key) {
      return {
        text: '用法：/deepseek-key sk-xxxxxxxx\n（把 Key 存进插件存储；也可以改用环境变量 DEEPSEEK_API_KEY）',
      }
    }
    await $.store.set('apiKey', key)
    await refreshBalance($, cfg)
    const error = await read($, errorAtom)
    return { text: error ? `Key 已保存，但刷新失败：${shortError(error)}` : 'Key 已保存，余额已刷新。' }
  })

  // ── 抽奖 ──────────────────────────────────────────────────────────

  on('command.run', { command: 'deepseek-draw' }, async ($) => ({ text: await startDraw($) }))

  on('command.run', { command: 'deepseek-dex' }, async ($) => {
    const record = await readGacha($)
    return { text: dexLines(record).join('\n') }
  })

  // ── 横条本体 ──────────────────────────────────────────────────────
  // AbovePrompt 只在 terminal 和 desktop 两个 surface 上拉起，所以这一个钩子
  // 就是「同时应用到 CLI 和 Desktop」的那一处。

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // 有人在用这条带子做问卷，让给它
    if (e.props.hasSurvey) return next(e)
    if (await read($, hiddenAtom)) return next(e)

    // 新会话默认不出现：只有认出来跑的是 DeepSeek 模型，这条带子才画。
    // 模型在 session.start 和每一轮里都会更新，所以中途切模型也会跟着变。
    if (!isDeepSeekModel(await read($, modelAtom))) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const balance = await read($, balanceAtom)
    const usage = await read($, usageAtom)
    const error = await read($, errorAtom)

    // 余额
    let balanceNode: RenderElement | null = null
    if (cfg.showBalance) {
      const label = balance
        ? money(balance.total, currencySymbol(balance.currency))
        : error
          ? shortError(error)
          : '…'
      balanceNode = (
        <Text key="balance" color={balanceLevel(balance)}>
          {label}
        </Text>
      )
    }

    // 本会话估算花费的进度条：每满 ¥1 归零重来。走满的每一元换来一次抽奖
    // 机会，但次数只在命令里显示，所以这里不再标 ×N。
    let cycleNode: RenderElement | null = null
    if (cfg.showCycle) {
      const percent = cyclePercent(usage.estimatedCost, CYCLE_BUDGET)
      cycleNode = (
        <Text key="cycle">
          {renderBar(percent)} {percent.toFixed(1)}%
          <Text dimColor>
            {' '}
            {cfg.priceSymbol}
            {CYCLE_BUDGET}
          </Text>
        </Text>
      )
    }

    // 本会话用量：token 是逐轮上报的真实计数，花费是按单价折算出来的估算值。
    let usageNode: RenderElement | null = null
    if (cfg.showUsage && usage.turns > 0) {
      usageNode = (
        <Text key="usage" dimColor>
          ↑{compact(usage.inputTokens)} ↓{compact(usage.outputTokens)}{' '}
          ≈{money(usage.estimatedCost, cfg.priceSymbol)}
        </Text>
      )
    }

    // 只在实际画出来的片段之间插分隔符，免得隐藏一栏后留下孤零零的 ·
    const pieces = [balanceNode, cycleNode, usageNode].filter(
      (node): node is RenderElement => node !== null,
    )
    const children: RenderNode[] = pieces.flatMap((node, index) =>
      index === 0 ? [node] : [<Text key={`sep${index}`} dimColor>·</Text>, node],
    )

    return (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Text bold color="claude">
          DeepSeek
        </Text>
        {children}
        <Button key="toggle" label="隐藏" plain onPress={() => void update($, hiddenAtom, () => true)} />
      </Box>
    )
  })

  // ── 抽奖面板 ──────────────────────────────────────────────────────
  // Pane 站点在终端、Desktop、VS Code 上都渲染，所以转盘只写这一份。

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== GACHA_PANE) return next(e)

    const spin = await read($, spinAtom)
    if (spin.phase === 'idle' || !spin.tier) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const tier = TIER_BY_ID[spin.tier]
    const item = spin.itemId ? ITEM_BY_ID[spin.itemId] : undefined
    const revealed = spin.phase === 'revealed'

    const wheel = wheelGrid(spin.tier, revealed ? WHEEL_FRAMES - 1 : spin.frame).map((cells, y) => (
      <Box key={`row${y}`} flexDirection="row">
        {encodeRow(cells).map((run, x) =>
          run.color === null ? (
            <Text key={`cell${x}`}>{' '.repeat(run.width)}</Text>
          ) : (
            <Text key={`cell${x}`} backgroundColor={run.color}>
              {' '.repeat(run.width)}
            </Text>
          ),
        )}
      </Box>
    ))

    return (
      <Box flexDirection="column">
        {wheel}
        {revealed && item ? (
          <Box flexDirection="row" gap={1}>
            <Text bold color={tier.color}>
              {tier.name}
            </Text>
            <Text>{item.name}</Text>
            <Text dimColor>{tier.value}</Text>
          </Box>
        ) : (
          <Text dimColor>转动中…</Text>
        )}
        <Box flexDirection="row" gap={1}>
          {revealed && spin.pending > 0 ? (
            <Button
              key="again"
              label={`再来一次（还剩 ${spin.pending} 次）`}
              onPress={() => void startDraw($)}
            />
          ) : null}
          <Button key="close" label="关闭" onPress={() => void $.ui.close({ id: GACHA_PANE })} />
        </Box>
      </Box>
    )
  })
}
