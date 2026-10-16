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
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'deepseek-cost-hud'

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
 * `session.model` 决定横条出不出现，所以默认给一个 DeepSeek 模型；要测「非
 * DeepSeek 就整条不画」传别的模型 id 进来。
 */
function stubEngine(on: On, model = 'deepseek-flash'): void {
  on('command.register', () => ({ value: { command: '' } }))
  on('session.model', () => ({ value: model }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine drew its own'] }))
}

/** 备齐一次会话开始所需的答案，再真的触发 session.start。 */
async function startSession($: Engine, on: On): Promise<void> {
  mock.clock(on)
  mock.store(on)
  on('session.start', () => ({ cwd: '/tmp/hud' }))
  await $.session.start({ cwd: '/tmp/hud', surface: 'terminal', isInteractive: true })
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
  const band = await ui.find({ text: /×1/ })
  expect(band?.text).toMatch(/5\.0%/)
  expect(band?.text).toMatch(/¥1 ×1/)
})

test('非 DeepSeek 模型时整条横条都不画，那一轮也不进账', async ($, on) => {
  mock.env(on, { DEEPSEEK_API_KEY: 'sk-test' })
  stubEngine(on, 'glm-5.3')
  stubBalance(on)
  on('turn.complete', () => ({ text: '' }))
  await startSession($, on)

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
