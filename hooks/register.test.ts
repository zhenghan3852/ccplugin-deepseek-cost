/**
 * deepseek-cost-hud 的测试。
 *
 * 跑法：claude plugin test .
 *
 * 重点是第一条：横条挂在 `AbovePrompt` 上，而引擎只在 terminal 和 desktop
 * 两个 surface 渲染这个站点 —— 所以把同一份断言在两个 surface 上各跑一遍，
 * 就是「这一份代码真的跨端」的证据。
 *
 * 测试里的坑（踩过才知道）：session.start 不会自己跑，得测试先把它和它在
 * 内部调用的接口都 stub 住再触发；否则钩子在第一个没实现的调用处被跳过，
 * 后面整段都不执行，而测试只会含糊地报 no implementation。
 */

import type { On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { ITEMS, ITEMS_BY_TIER, rollDraw, TIERS, WHEEL_SLOTS } from './gacha-items'
import {
  finalRotation,
  slotAtPointer,
  wheelGrid,
  WHEEL_FRAMES,
  WHEEL_SIZE,
  WHEEL_TICK_MS,
} from './gacha-wheel'

const PLUGIN = 'deepseek-cost-hud'
const GACHA_PANE = 'deepseek-gacha'

/** 固定一份 /user/balance 的响应体，免得测试真的联网。 */
const BALANCE_BODY = JSON.stringify({
  is_available: true,
  balance_infos: [
    {
      currency: 'CNY',
      total_balance: '40.36',
      granted_balance: '10.36',
      topped_up_balance: '30.00',
    },
  ],
})

/** AbovePrompt 的 props，按引擎声明的字段填齐。 */
const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 8,
  bodyColumns: 120,
  /** 窗口停在树顶；8 行够放这条单行横条 */
  scroll: { offset: 0, bodyRows: 8 },
  /** 看的是主对话，不是某个 subagent 的 */
  view: {},
}

/** 测试的 on 坐在插件下方，所以它能替插件里的 $.http.fetch 作答。 */
function stubBalance(on: On): void {
  on('http.fetch', { url: /\/user\/balance$/ }, () => ({
    value: { status: 200, ok: true, headers: {}, text: BALANCE_BODY },
  }))
}

/**
 * 引擎自带的接口测试里没人作答，插件用到哪几个就得替哪几个备一个。
 * 横条隐藏时钩子走 next(e)，引擎接着画自己的内容 —— 那条路也要有个替身。
 *
 * 插件**不读** `$.session.model()`：它给的是映射前的客户端模型名（走网关时是
 * `claude-haiku-4-5[1m]` 这种），判断不了"是不是 DeepSeek"。上游真名只从每轮
 * `turn.complete` 的响应里认，认到后会记进 store 供后续会话回放。
 */
function stubEngine(on: On): void {
  on('command.register', () => ({ value: { command: '' } }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine drew its own'] }))
}

/** 备齐一次会话开始所需的答案，再真的触发 session.start。 */
async function startSession($: Engine, on: On, seedStore?: () => void): Promise<MockClock> {
  const clock = mock.clock(on)
  // seedStore 用来换掉内置的 store 替身：`mock.store` 不回显写进去的东西，
  // 想在抽奖后检查账本、或想改变"已确认的模型"，测试得自己拿一个 Map 接住读写。
  //
  // 默认那份 store 里预置了 lastModel —— 也就是"这台机器已经确认过在跑
  // DeepSeek"。不给的话横条按设计就不该出现（要等第一轮回答才认出来）。
  if (seedStore) seedStore()
  else mock.store(on, { lastModel: 'deepseek-flash' })
  on('session.start', () => ({ cwd: '/tmp/hud' }))
  await $.session.start({ cwd: '/tmp/hud', surface: 'terminal', isInteractive: true })
  return clock
}

/** 跑一条插件注册的命令。本版本的 `command.run` 要 origin 与 presentation。 */
function runCommand($: Engine, command: string): Promise<{ text?: string }> {
  return $.command.run({
    command,
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
}

/** 假的全局账本：读改写都落在同一个 Map 上，测试能直接查。 */
function fakeStore(entries: Record<string, unknown> = {}) {
  const saved = new Map<string, unknown>(Object.entries(entries))
  return {
    saved,
    stub(on: On): void {
      on('store.get', ($, e) => ({ value: saved.get(e.key) }))
      on('store.set', ($, e) => {
        saved.set(e.key, e.value)
        return { value: undefined }
      })
    },
  }
}

/** 一条走完的轮次，带真实形状的 usage。 */
const TURN = {
  answer: 'ok',
  reason: 'answer',
  durationMs: 1200,
  isAborted: false,
  turnId: 'turn-1',
  usage: {
    model: 'deepseek-flash',
    input_tokens: 3200,
    output_tokens: 4500,
    cache_read_input_tokens: 9100,
    cache_creation_input_tokens: 0,
  },
} as const

test('横条在 terminal 和 desktop 两个 surface 上都画得出来', async ($, on) => {
  mock.env(on, { DEEPSEEK_API_KEY: 'sk-test' })
  stubEngine(on)
  stubBalance(on)
  await startSession($, on)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'AbovePrompt',
      props: BAND_PROPS,
    })

    // 余额来自被 stub 的接口，两边都该拿到同一个数
    expect(await ui.find({ text: '¥40.36' })).toBeDefined()
  }
})

test('走完一轮之后画出 token 用量', async ($, on) => {
  mock.env(on, { DEEPSEEK_API_KEY: 'sk-test' })
  stubEngine(on)
  stubBalance(on)
  // 所有替身都要在第一次调用 $ 之前登记
  on('turn.complete', () => ({ text: '' }))
  await startSession($, on)

  await $.turn.complete(TURN)

  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND_PROPS,
  })

  // ↑ 是输入，↓ 是输出；两个数都来自上面那份 usage
  expect(await ui.find({ text: '↑3.2k ↓4.5k' })).toBeDefined()
})

test('按下隐藏按钮后横条不再绘制', async ($, on) => {
  mock.env(on, { DEEPSEEK_API_KEY: 'sk-test' })
  stubEngine(on)
  stubBalance(on)
  await startSession($, on)

  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND_PROPS,
  })

  expect(await ui.find({ text: '¥40.36' })).toBeDefined()

  await ui.press({ key: 'toggle' })

  // 钩子返回 next(e) 让引擎自己画，所以这里应当找不到我们那一段余额
  expect(await ui.find({ text: '¥40.36' })).toBeUndefined()
})

test('没有 Key 时不画余额，只给一个可读的提示', async ($, on) => {
  mock.env(on, {})
  stubEngine(on)
  stubBalance(on)
  await startSession($, on)

  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND_PROPS,
  })

  expect(await ui.find({ text: '未配置 Key' })).toBeDefined()
})

test('花费进度条走满一轮就归零，并标出已经走满的轮数', async ($, on) => {
  mock.env(on, { DEEPSEEK_API_KEY: 'sk-test' })
  stubEngine(on)
  stubBalance(on)
  on('turn.complete', () => ({ text: '' }))
  await startSession($, on)

  // 时钟从 0 起步（1970-01-01 周四 00:00 UTC），按错峰算，单价是高峰价的一半：
  // 26.25 万输出 token × ¥8/M × 50% = ¥1.05。输入与缓存那一份清零，好让进度条
  // 正好落在 5.0% 上，断言才不含糊。
  await $.turn.complete({
    ...TURN,
    usage: {
      ...TURN.usage,
      input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 262_500,
    },
  })

  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND_PROPS,
  })

  // find 不认 key（键不在挂载出来的 props 里），所以按文本断言整条横条
  const band = await ui.find({ text: /5\.0% ¥1/ })
  expect(band).toBeDefined()
  // ×N 已按需求取消：横条上不该再出现乘号
  expect(band?.text).not.toMatch(/×/)
})

test('非 DeepSeek 模型时整条横条都不画，那一轮也不进账', async ($, on) => {
  mock.env(on, { DEEPSEEK_API_KEY: 'sk-test' })
  stubEngine(on)
  stubBalance(on)
  on('turn.complete', () => ({ text: '' }))
  // 这台机器上次确认的模型是 glm，所以新会话一开就不画横条
  const store = fakeStore({ lastModel: 'glm-5.3' })
  await startSession($, on, () => store.stub(on))

  // 走完一轮（这一轮报的也是 glm），钩子仍应直接 next(e)，把这条带子让给引擎
  await $.turn.complete({ ...TURN, usage: { ...TURN.usage, model: 'glm-5.3' } })

  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND_PROPS,
  })
  expect(await ui.find({ text: /DeepSeek/ })).toBeUndefined()

  // 那一轮不该进账：报告里连用量都不该有，并且把「不计价」说明白
  const report = await $.command.run({
    command: 'deepseek-cost',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(report.text).toContain('非 DeepSeek 模型')
  expect(report.text).toContain('还没有走完一轮')
})

// ── 抽奖 ────────────────────────────────────────────────────────────

/** 按顺序吐出固定值的假随机源；用完后一直返回最后一个。 */
function sequence(values: readonly number[]): () => number {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)] ?? 0
}

/** 面板的 props，按 Pane 站点声明的字段填齐。 */
const PANE_PROPS = {
  title: '抽奖',
  isFocused: true,
  bodyColumns: 60,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows: 14 },
  view: {},
}

test('物品表：5 档 100 件，概率之和为 1', () => {
  expect(ITEMS.length).toBe(100)
  expect(TIERS.map((t) => ITEMS_BY_TIER[t.id].length)).toEqual([70, 15, 8, 5, 2])
  expect(new Set(ITEMS.map((i) => i.id)).size).toBe(100)
  // 浮点求和有末位误差，放大到百万分之一再比
  expect(Math.round(TIERS.reduce((acc, t) => acc + t.chance, 0) * 1e6)).toBe(1_000_000)
})

test('rollDraw：按概率生成六个色块，指针在六块上等概率落点', () => {
  // 随机源恒为 0 → 每块都取到概率最高的普通档，指针落第 0 块
  const allCommon = rollDraw(() => 0)
  expect(allCommon.slots).toEqual(Array(WHEEL_SLOTS).fill('common'))
  expect(allCommon.winner).toBe(0)
  expect(allCommon.tier).toBe('common')

  // 指针落点是均匀的：0.99 落在最后一块
  const lastSlot = rollDraw(sequence([0, 0, 0, 0, 0, 0, 0.99, 0]))
  expect(lastSlot.winner).toBe(WHEEL_SLOTS - 1)
  expect(lastSlot.tier).toBe('common')

  // 中奖档位就是指针停下的那一块 —— 不是另外算出来的
  const mixed = rollDraw(sequence([0, 0.999, 0, 0, 0, 0, 0.3, 0]))
  expect(mixed.slots[1]).toBe('legendary')
  expect(mixed.winner).toBe(1)
  expect(mixed.tier).toBe('legendary')

  // 档内均匀：指针落第 0 块（普通）时，rand 0 取第一件、0.9999 取最后一件
  const common = ITEMS_BY_TIER.common
  expect(rollDraw(sequence([0, 0, 0, 0, 0, 0, 0, 0])).item).toEqual(common[0])
  expect(rollDraw(sequence([0, 0, 0, 0, 0, 0, 0, 0.9999])).item).toEqual(
    common[common.length - 1],
  )
})

test('终帧的指针一定停在中奖那一块上', () => {
  // 结果先定、角度反推 —— 这是整个动画的核心不变量
  for (let slot = 0; slot < WHEEL_SLOTS; slot++) {
    expect(slotAtPointer(finalRotation(slot))).toBe(slot)
  }
})

test('终帧盘面上，指针那一格就是中奖块的档位', () => {
  const slots = ['common', 'rare', 'uncommon', 'epic', 'legendary', 'common'] as const
  const middle = (WHEEL_SIZE - 1) / 2
  for (let slot = 0; slot < WHEEL_SLOTS; slot++) {
    // 指针在正上方 = 第 0 行、正中那一列
    expect(wheelGrid(slots, slot, WHEEL_FRAMES - 1)[0]?.[middle]).toBe(slots[slot])
  }
})

test('转盘是个圆环：中心和四角留空，环上有档位', () => {
  const slots = ['common', 'rare', 'uncommon', 'epic', 'legendary', 'common'] as const
  const grid = wheelGrid(slots, 0, 0)
  const middle = (WHEEL_SIZE - 1) / 2
  expect(grid[middle]?.[middle]).toBeNull()
  expect(grid[0]?.[0]).toBeNull()
  expect(grid[0]?.[middle]).not.toBeNull()
  // 转起来了：同一盘不同帧画面不该一样
  expect(wheelGrid(slots, 0, 20)).not.toEqual(wheelGrid(slots, 0, 0))
})

test('抽奖：扣一次次数、记进图鉴、开出面板', async ($, on) => {
  mock.env(on, { DEEPSEEK_API_KEY: 'sk-test' })
  stubEngine(on)
  stubBalance(on)
  let openCalls = 0
  on('ui.open', () => {
    openCalls += 1
    return { value: { isPlaced: true } }
  })
  const store = fakeStore({ gacha: { spent: 3, drawn: 0, owned: {} } })
  await startSession($, on, () => store.stub(on))

  const answer = await runCommand($, 'deepseek-draw')
  expect(answer.text).toMatch(/^抽到了：/)
  expect(openCalls).toBe(1)

  const record = store.saved.get('gacha') as { drawn: number; owned: Record<string, number> }
  expect(record.drawn).toBe(1)
  expect(Object.values(record.owned)).toEqual([1])
})

test('面板放不下时照样开奖，只是不播动画', async ($, on) => {
  mock.env(on, { DEEPSEEK_API_KEY: 'sk-test' })
  stubEngine(on)
  stubBalance(on)
  on('ui.open', () => ({ value: { isPlaced: false, reason: '终端太窄' } }))
  const store = fakeStore({ gacha: { spent: 1, drawn: 0, owned: {} } })
  await startSession($, on, () => store.stub(on))

  const answer = await runCommand($, 'deepseek-draw')
  // 次数照扣、东西照到手 —— 动画只是表现层
  expect(answer.text).toContain('没播动画')
  expect((store.saved.get('gacha') as { drawn: number }).drawn).toBe(1)
})

test('没有可抽次数时不抽，也不开面板', async ($, on) => {
  mock.env(on, { DEEPSEEK_API_KEY: 'sk-test' })
  stubEngine(on)
  stubBalance(on)
  let openCalls = 0
  on('ui.open', () => {
    openCalls += 1
    return { value: { isPlaced: true } }
  })
  const store = fakeStore({ gacha: { spent: 0, drawn: 0, owned: {} } })
  await startSession($, on, () => store.stub(on))

  const answer = await runCommand($, 'deepseek-draw')
  expect(answer.text).toContain('还没有可抽的次数')
  expect(openCalls).toBe(0)
  expect((store.saved.get('gacha') as { drawn: number }).drawn).toBe(0)
})

test('转盘逐帧推进，走完停在开奖态', async ($, on) => {
  mock.env(on, { DEEPSEEK_API_KEY: 'sk-test' })
  stubEngine(on)
  stubBalance(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const store = fakeStore({ gacha: { spent: 2, drawn: 0, owned: {} } })
  const clock = await startSession($, on, () => store.stub(on))

  await runCommand($, 'deepseek-draw')

  const pane = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'Pane',
    requestId: GACHA_PANE,
    viewport: { columns: 100, rows: 30 },
    props: PANE_PROPS,
  })
  expect(await pane.find({ text: '转动中…' })).toBeDefined()
  // 宽度必须撑住：11×11 全是实心块，拼起来是连续 121 个 —— 一旦被折叠/压窄
  // 就不是这个数（"转盘变扁"那个 bug 的回归护栏，屏幕我看不到，让测试盯着）
  expect(await pane.find({ text: new RegExp(`█{${WHEEL_SIZE * WHEEL_SIZE}}`) })).toBeDefined()

  // 帧数走完（时钟是 mock 的，推进多少就是多少）
  await clock.advance(WHEEL_TICK_MS * WHEEL_FRAMES)
  await pane.redraw()

  expect(await pane.find({ text: '转动中…' })).toBeUndefined()
  expect(await pane.find({ text: /普通|稀有|罕见|史诗|传说/ })).toBeDefined()
})

test('图鉴：命令回一行汇总，明细在面板里按档列出来', async ($, on) => {
  mock.env(on, { DEEPSEEK_API_KEY: 'sk-test' })
  stubEngine(on)
  stubBalance(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.invalidate', () => ({ value: undefined }))
  const store = fakeStore({
    gacha: { spent: 5, drawn: 2, owned: { tissue: 1, 'milk-tea': 1 } },
  })
  await startSession($, on, () => store.stub(on))

  const answer = await runCommand($, 'deepseek-dex')
  expect(answer.text).toContain('3 次') // floor(5) - 2
  expect(answer.text).toContain('图鉴 2/100')

  const pane = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'Pane',
    requestId: 'deepseek-dex',
    viewport: { columns: 100, rows: 40 },
    props: PANE_PROPS,
  })
  expect(await pane.find({ text: /普通 1\/70/ })).toBeDefined()
  expect(await pane.find({ text: /一包抽纸×1/ })).toBeDefined()
  expect(await pane.find({ text: /稀有 1\/15/ })).toBeDefined()
  expect(await pane.find({ text: /一杯奶茶×1/ })).toBeDefined()
  // 一件都没抽到的档位也要露脸，标成"还没抽到"
  expect(await pane.find({ text: /传说 0\/2/ })).toBeDefined()
})

test('图鉴：面板放不下时回退成完整文本，信息不丢', async ($, on) => {
  mock.env(on, { DEEPSEEK_API_KEY: 'sk-test' })
  stubEngine(on)
  stubBalance(on)
  on('ui.open', () => ({ value: { isPlaced: false, reason: '终端太窄' } }))
  const store = fakeStore({
    gacha: { spent: 5, drawn: 2, owned: { tissue: 1 } },
  })
  await startSession($, on, () => store.stub(on))

  const answer = await runCommand($, 'deepseek-dex')
  expect(answer.text).toContain('普通（≈¥1）  1/70')
  expect(answer.text).toContain('一包抽纸×1')
  expect(answer.text).toContain('传说（≈¥1000）  0/2')
})

test('每走完一轮就多一次抽奖机会，次数记在全局账本上', async ($, on) => {
  mock.env(on, { DEEPSEEK_API_KEY: 'sk-test' })
  stubEngine(on)
  stubBalance(on)
  on('turn.complete', () => ({ text: '' }))
  const store = fakeStore({ gacha: { spent: 0, drawn: 0, owned: {} } })
  await startSession($, on, () => store.stub(on))

  // 错峰下 26.25 万输出 token × ¥8/M × 50% = ¥1.05 —— 刚好攒满一次
  await $.turn.complete({
    ...TURN,
    usage: {
      ...TURN.usage,
      input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 262_500,
    },
  })

  const record = store.saved.get('gacha') as { spent: number }
  expect(Math.round(record.spent * 100) / 100).toBe(1.05)
})

test('模型在第一次回答后才认出来，并记进 store 供后续会话回放', async ($, on) => {
  mock.env(on, { DEEPSEEK_API_KEY: 'sk-test' })
  stubEngine(on)
  stubBalance(on)
  on('turn.complete', () => ({ text: '' }))
  // 空账本 = 这台机器还没确认过在跑什么模型
  const store = fakeStore()
  await startSession($, on, () => store.stub(on))

  // 第一轮之前：还不知道，横条按设计不出现（这正是 cc-switch 场景下的初态）
  const band = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND_PROPS,
  })
  expect(await band.find({ text: /DeepSeek/ })).toBeUndefined()

  // 走完一轮：响应报的是上游真名，认出来并记下
  await $.turn.complete(TURN)
  expect(store.saved.get('lastModel')).toBe('deepseek-flash')

  await band.redraw()
  expect(await band.find({ text: '¥40.36' })).toBeDefined()
})

// ── 设置 Key（写进 macOS 钥匙串）──────────────────────────────────────

/** 面板的 props（设置 Key 那个）。 */
const KEY_PANE_PROPS = {
  title: '设置 API Key',
  isFocused: true,
  bodyColumns: 46,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

test('设置 Key：面板里回车 → 写进钥匙串并回报成功', async ($, on) => {
  mock.env(on, {})
  stubEngine(on)
  stubBalance(on)
  const runs: string[][] = []
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.invalidate', () => ({ value: undefined }))
  await startSession($, on)
  await runCommand($, 'deepseek-key')

  const pane = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'Pane',
    requestId: 'deepseek-key',
    viewport: { columns: 100, rows: 24 },
    props: KEY_PANE_PROPS,
  })
  expect(await pane.find({ text: /DeepSeek API Key/ })).toBeDefined()

  await pane.input({ key: 'key', text: 'sk-from-pane' })
  const write = runs.find((argv) => argv.includes('add-generic-password'))
  expect(write).toEqual([
    'security',
    'add-generic-password',
    '-U',
    '-s',
    'deepseek-cost-hud',
    '-a',
    'apiKey',
    '-w',
    'sk-from-pane',
  ])
  expect(await pane.find({ text: /已存入钥匙串/ })).toBeDefined()
})

test('设置 Key：写失败就说失败，不假装成功', async ($, on) => {
  mock.env(on, {})
  stubEngine(on)
  stubBalance(on)
  on('process.run', () => ({
    value: {
      exitCode: 1,
      stdout: '',
      stderr: 'errSecAuthFailed',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.invalidate', () => ({ value: undefined }))
  await startSession($, on)
  await runCommand($, 'deepseek-key')

  const pane = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'Pane',
    requestId: 'deepseek-key',
    viewport: { columns: 100, rows: 24 },
    props: KEY_PANE_PROPS,
  })
  await pane.input({ key: 'key', text: 'sk-nope' })
  expect(await pane.find({ text: /没存进去：errSecAuthFailed/ })).toBeDefined()
  expect(await pane.find({ text: /已存入钥匙串/ })).toBeUndefined()
})

test('钥匙串里的 key 优先于环境变量 —— 真的用在余额请求上', async ($, on) => {
  // 环境里有真 key 和代理令牌，但钥匙串里那份应该赢
  mock.env(on, { DEEPSEEK_API_KEY: 'sk-from-env', ANTHROPIC_AUTH_TOKEN: 'ccs-proxy' })
  stubEngine(on)
  let sentAuth = ''
  on('http.fetch', { url: /\/user\/balance$/ }, ($, e) => {
    sentAuth = String(e.init?.headers?.Authorization ?? '')
    return { value: { status: 200, ok: true, headers: {}, text: BALANCE_BODY } }
  })
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: 'sk-from-keychain\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  await startSession($, on)

  expect(sentAuth).toBe('Bearer sk-from-keychain')
})

test('余额拿不到时，横条上就地出现 Key 输入框', async ($, on) => {
  mock.env(on, {}) // 没有任何来源的 Key
  stubEngine(on)
  stubBalance(on)
  const runs: string[][] = []
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    return {
      value: {
        exitCode: 0,
        stdout: '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  await startSession($, on)

  const band = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND_PROPS,
  })
  // 余额位显示失败原因（未配置 Key），旁边就是可输入的框
  expect(await band.find({ text: '未配置 Key' })).toBeDefined()
  expect(await band.find({ type: 'Input' })).toBeDefined()

  // 在横条里输入即可写进钥匙串 —— 不用另开面板
  await band.input({ key: 'key', text: 'sk-from-band' })
  const write = runs.find((argv) => argv.includes('add-generic-password'))
  expect(write).toEqual([
    'security',
    'add-generic-password',
    '-U',
    '-s',
    'deepseek-cost-hud',
    '-a',
    'apiKey',
    '-w',
    'sk-from-band',
  ])
})

test('余额正常时横条上没有 Key 输入框', async ($, on) => {
  mock.env(on, { DEEPSEEK_API_KEY: 'sk-test' })
  stubEngine(on)
  stubBalance(on)
  await startSession($, on)

  const band = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND_PROPS,
  })
  expect(await band.find({ text: '¥40.36' })).toBeDefined()
  expect(await band.find({ type: 'Input' })).toBeUndefined()
})

test('刷新失败时不拿缓存冒充余额：横条报错并给出 Key 输入框', async ($, on) => {
  // 有 token 但被服务端拒绝（就是 cc-switch 代理令牌那种处境），
  // 于是请求真的发出去、真的拿到 401
  mock.env(on, { ANTHROPIC_AUTH_TOKEN: 'ccs-proxy-token' })
  stubEngine(on)
  // 缓存里有一份旧余额（session.start 会先铺上去），但实时请求会 401
  const store = fakeStore({
    lastModel: 'deepseek-flash',
    balance: {
      isAvailable: true,
      currency: 'CNY',
      total: 74.7,
      granted: 5.89,
      toppedUp: 68.81,
      fetchedAt: 1,
    },
  })
  on('http.fetch', { url: /\/user\/balance$/ }, () => ({
    value: { status: 401, ok: false, headers: {}, text: '{"error":"auth"}' },
  }))
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: '',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  await startSession($, on, () => store.stub(on))

  const band = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND_PROPS,
  })
  // 错误优先于缓存值，并把旧数字标出来
  expect(await band.find({ text: /HTTP 401/ })).toBeDefined()
  expect(await band.find({ text: /缓存¥74.70/ })).toBeDefined()
  // 关键：输入框必须出现，否则用户没地方修
  expect(await band.find({ type: 'Input' })).toBeDefined()

  const report = await runCommand($, 'deepseek-cost')
  expect(report.text).toContain('缓存值')
  expect(report.text).toContain('HTTP 401')
})

test('非 macOS：写钥匙串失败时给的是可操作的提示，不是原始报错', async ($, on) => {
  mock.env(on, {})
  stubEngine(on)
  stubBalance(on)
  // Windows/Linux 上没有 security 命令 —— $.process.run 会拒绝
  on('process.run', () => ({ deny: 'spawn security ENOENT' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.invalidate', () => ({ value: undefined }))
  await startSession($, on)
  await runCommand($, 'deepseek-key')

  const pane = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'Pane',
    requestId: 'deepseek-key',
    viewport: { columns: 100, rows: 24 },
    props: KEY_PANE_PROPS,
  })
  await pane.input({ key: 'key', text: 'sk-x' })
  expect(await pane.find({ text: /没有 security 命令/ })).toBeDefined()
  expect(await pane.find({ text: /ENOENT/ })).toBeUndefined()
})
