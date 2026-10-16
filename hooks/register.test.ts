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

/** 会话用量：横条上的上下文进度条取自这里。 */
const SESSION_USAGE = {
  startedAt: 0,
  context: { tokens: 120_000, window: 1_000_000, percent: 12 },
  rateLimits: [],
}

/**
 * 引擎自带的接口测试里没人作答，插件用到哪几个就得替哪几个备一个。
 * 横条隐藏时钩子走 next(e)，引擎接着画自己的内容 —— 那条路也要有个替身。
 */
function stubEngine(on: On): void {
  on('command.register', () => ({ value: { command: '' } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.usage', () => ({ value: SESSION_USAGE }))
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
