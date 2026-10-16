# deepseek-cost-hud

**Claude Code 的 DeepSeek 余额 / 花费 HUD，一份代码同时跑在终端和桌面端。**

```
DeepSeek  ¥86.33  ·  ████░░░░░░ 42.0% ¥100 ×2  ·  ↑125.3k ↓54.4k ≈¥1.31   隐藏
```

这一行横条画在输入框正上方：Claude Code 命令行里是终端底部那条带子，Claude Desktop 里是同一个位置的横条。用的是同一份代码、同一个渲染钩子。

横条上四段：

| 段 | 含义 |
|---|---|
| `¥86.33` | 账户余额，**接口返回的真实值**。颜色随余额高低变化 |
| `████░░░░░░ 42.0% ¥100 ×2` | 本会话**估算花费**的进度条。走满一轮就归零重来，`×2` 是已经走满的轮数 |
| `↑125.3k ↓54.4k` | 本会话输入 / 输出 token，**每轮 API 报告的真实计数** |
| `≈¥1.31` | 本会话估算花费，`≈` 表示它是折算出来的 |

右下角 `隐藏` 按钮可以把整条收起。

---

## 为什么一份代码能同时上两个端

关键在于**没有走 statusLine**。

Claude Code 传统的状态栏是 `settings.json` 里的 `statusLine` 命令：Claude Code 每约 300ms 把一段 JSON 打到子进程 stdin，子进程把带 ANSI 颜色的字符串写回 stdout。这条路只在终端成立 —— Desktop 没有"状态栏"这个位置，也就无从接管。

本插件改用**函数钩子（mod）**：插件是一个导出 `register(on, options)` 的模块，Claude Code 在 CLI 和 Desktop 两个宿主里都会加载它，而 `$` 这一个接口在两处都成立 ——

| 需求 | 接口 | 两个端都成立 |
|---|---|---|
| 发 HTTP | `$.http.fetch` | ✅ 走宿主，不由插件自己联网 |
| 存余额缓存 | `$.store` / `$.state` | ✅ 宿主持有，跨会话 |
| 画界面 | `$.ui.render` | ✅ 按 surface 解析元素表 |
| 定时刷新 | `$.clock.every` | ✅ 宿主时钟，跨钩子存活 |

所以跨端不是靠兼容层堆出来的，而是这个接口本身就跨端。

**画在哪一个渲染位**也同样要紧。引擎提供的站点里，只有 `AbovePrompt` 标注为 *Terminal, Desktop* 两个 surface 都渲染（`Pane` 多一个 VS Code，`ToolProgress` / `TurnDuration` 只有终端）。横条挂在 `AbovePrompt` 上，两端就都能看见。

整条 HUD **只画这一处**：不往状态行（`$.ui.status`）顶摘要 —— Desktop 里那会在输入框下面再冒出一行，和横条重复。

---

## 数据从哪来：哪些是真实的，哪些是算出来的

这三件事的确定性完全不同，插件也把它们分得清清楚楚：

### 余额 —— 真实值，来自 DeepSeek 接口

```
GET https://api.deepseek.com/user/balance
Authorization: Bearer <你的 API Key>
```

返回账户里真正剩下的钱，含充值余额与赠送余额。**这是权威值，不是估算。** 币种用接口返回的（人民币账户就是 `CNY`）。

### token 用量 —— 真实计数，来自每轮 API 响应

每轮 `turn.complete` 事件带回来该轮真实请求的 token 数（输入、输出、缓存命中、缓存写入），逐轮累加得到本会话的总用量。**这是真实计数。**

DeepSeek 官方 API Reference 里只有 `Chat Completions`、`Responses`、`FIM Completion (Beta)`、`Lists Models`、`Get User Balance`、`Files` 这几组接口 —— **没有**任何查询用量、账单或消费记录的接口。所以"用量"只能这样从响应里攒，没有第二条路。

### 花费 —— 估算值，用单价折算

token 数 × 单价，逐轮结算：每一轮按**那一刻**属于高峰还是错峰选单价，所以跨时段的长会话会自动把两种价都算进去，而不是拿一个价乘全部。

### 为什么没有"实测"花费

余额差额（会话开始时的余额 − 现在的余额）看起来能给出一个实测值，但**它不能归属到某个会话**：

```
t0  会话 A 启动，余额 100        A 基准 = 100
t1  会话 B 启动，余额 99                          B 基准 = 99
t2  会话 B 花掉 1，余额 98       A 报"花了 2" ❌   B 报"花了 1" ✅
                                A 其实一分没花
```

余额是**账户级**的、不带任何归属信息，同一账户下别的会话或程序花掉的钱一样会从差额里掉下来。而每个会话都在每 60 秒轮询同一个账户余额，于是每个会话都会把同一笔下降全记到自己头上 —— 开着 N 个会话，就能算出 N 倍的钱。

token 数才是**按会话上报**的，归属天然正确。所以会话花费一律以估算为准，不显示任何"实测"数字。

---

## 安装

### 从 GitHub 安装（推荐）

在**终端**里运行 Claude Code，然后：

```
/plugin install deepseek-cost-hud --marketplace zhenghan3852/ccplugin-deepseek-cost
```

提示 `Add marketplace?` 时答 `y`，选 **user 作用域**。

> **想在 Claude Desktop 里也用，就必须在终端装、且选 user 作用域。** Desktop 自己的 Code 标签页不接受 `/plugin install` 这条命令；但从终端装到 user 作用域的插件，Desktop 的本地会话会一并加载，它的 `ui.render` 钩子会以 `desktop` surface 绘制。

修改 `hooks/` 下的代码后要 **`/reload-plugins`**，或者重开一个会话 —— 已装的插件跑的是安装缓存里的副本，不是工作目录。

### 本地开发

```bash
git clone https://github.com/zhenghan3852/ccplugin-deepseek-cost.git
cd ccplugin-deepseek-cost
claude --plugin-dir .
```

`--plugin-dir` 加载的目录会被监视，改完存盘即重载。

---

## 配置 API Key

四种来源，按优先级：

1. 插件配置（`/plugin` 里填，或 `/config` 里改）
2. `/deepseek-key sk-xxxx` —— 存进插件自己的存储
3. 环境变量 `DEEPSEEK_API_KEY`
4. 环境变量 `ANTHROPIC_AUTH_TOKEN`

> ⚠️ 第 4 条只在 `ANTHROPIC_AUTH_TOKEN` 里放的是**真的 DeepSeek API Key** 时才有用。用 cc-switch 之类的工具走**代理模式**时，那里放的是本地代理令牌（形如 `ccs-...`），拿去打官方接口只会得到 401 —— 这种情况下请用前三种方式之一。

最省事的是第 3 种：

```bash
export DEEPSEEK_API_KEY="sk-xxxxxxxxxxxxxxxx"
```

---

## 命令

| 命令 | 作用 |
|---|---|
| `/deepseek-cost` | 本会话用量明细与估算花费，含进度条位置 |
| `/deepseek-hud` | 显示 / 隐藏横条 |
| `/deepseek-refresh` | 立刻刷新余额 |
| `/deepseek-key [sk-...]` | 保存 API Key |

`/deepseek-cost` 的样子：

```
余额        ¥86.33（充值 68.81 + 赠送 17.52）
本会话估算  ¥1.31   （进度条 1.3%，已走满 0 轮 ×¥100）
token       ↑125.3k（缓存命中 15.7M / 未命中 125.3k）  ↓54.4k   共 5 轮
缓存命中率  99.2%
当前计价    高峰
```

进度条每满一轮就归零，所以**想看本会话总共花了多少，只能在这里看**。

---

## 配置项

在 `/plugin` 或 `/config` 里改，也可以写进 `settings.json` 的 `pluginConfigs`。

| 配置 | 默认 | 说明 |
|---|---|---|
| `apiKey` | — | DeepSeek API Key（sensitive，存进系统凭据库） |
| `refreshSeconds` | `60` | 余额刷新间隔（秒） |
| `showBalance` | `true` | 显示余额 |
| `showCycle` | `true` | 显示花费进度条 |
| `showUsage` | `true` | 显示 token 用量与估算花费 |
| `balanceApiBase` | `https://api.deepseek.com` | 余额接口地址 |
| `priceCurrency` | `CNY` | 估算值的货币符号，**必须和下面三个单价的币种一致** |
| `priceInput` | `2` | 输入价 / 百万 token，缓存未命中，**高峰价** |
| `priceCacheRead` | `0.04` | 输入价 / 百万 token，缓存命中，**高峰价** |
| `priceOutput` | `8` | 输出价 / 百万 token，**高峰价** |
| `offPeakDiscount` | `50` | 错峰折扣（%），即错峰价 = 高峰价的 50% |

价格默认值取 **`deepseek-flash` 的官方人民币高峰价**。换模型或换价目表时改这三个数：

| | 缓存命中 | 缓存未命中 | 输出 |
|---|---|---|---|
| `deepseek-flash`（默认） | 0.04 | 2 | 8 |
| `deepseek-v4-pro` | 0.30 | 9 | 27 |
| `deepseek-flash`，美元价目 | 0.006 | 0.30 | 1.20 |
| `deepseek-v4-pro`，美元价目 | 0.044 | 1.32 | 3.96 |

用美元价目时记得把 `priceCurrency` 一起改成 `USD`。

---

## 错峰计价是怎么处理的

DeepSeek 官方价目把一天切成两档（据官方 API 文档 *Pricing* 页）：

- **高峰**：UTC 周一至周五 `01:00–04:00` 与 `06:00–10:00`（北京时间 `09:00–12:00`、`14:00–18:00`）
- **错峰**：其余全部时段 —— 含整个周末 —— 错峰价 = **高峰价的一半**

插件**逐轮结算**：每一轮 `turn.complete` 到达时就地判断那一刻属于哪一档，用对应单价折算那一轮，再加进累计值。所以一条跨了高峰和错峰的长会话，会自动把两种价都算进去。

> **已知不足**：官方口径里"中国法定节假日全天算错峰"，而这里只判了周末，没有节假日数据表。所以法定节假日当天估算会偏高一点。

---

## 已知边界

- **估算依赖单价正确**：单价是用户配置的，插件不去网上抓。默认值是 `deepseek-flash` 的人民币高峰价，换模型要手改。
- **节假日未识别**：见上。
- **子 agent 的消耗计入总数**：`turn.complete` 对子 agent 的轮次同样触发，那确实是真花掉的钱，所以计入。
- **余额币种与估算币种不一致时**：两边各自按自己的币种显示，不做换算。人民币账户配人民币价目就一致。
- **余额需要 Key 能通**：Key 拉不到余额时，余额那一栏显示失败原因（如 `HTTP 401`），进度条和 token 仍然照常工作 —— 它们不依赖网络。

---

## 开发

```bash
npm install
npm run typecheck   # tsc -p .
npm run validate    # claude plugin validate .
npm run test        # claude plugin test .
```

```
.claude-plugin/
  plugin.json        插件清单 + userConfig
  marketplace.json   这个仓库同时是一个 marketplace，可被 /plugin 直接导入
hooks/
  hooks.json         声明函数钩子模块
  register.tsx       全部逻辑
  register.test.ts   测试
types/
  index.d.ts         $.state 的类型契约
```

`tsconfig.json` 里 `typeRoots` 指向 `.claude-plugin/types/` —— 那是引擎在加载插件时自己写入的类型声明目录（每个 Claude Code 版本重写一次），已加进 `.gitignore`。本地首次类型检查前，先用 `claude --plugin-dir .` 加载一次插件让它生成。

> 如果 `claude` 不在 PATH 上（比如桌面版用户，`claude` 只是 shell 里的一个函数包装），可以直接调用桌面版自带的那份二进制 —— 桌面版把它解包在应用支持目录里：
>
> ```bash
> CLI=$(ls ~/Library/Application\ Support/Claude*/claude-code/*/*/claude.app/Contents/MacOS/claude 2>/dev/null | tail -1)
> "$CLI" plugin validate .
> "$CLI" plugin test .
> ```
>
> 版本目录名会随桌面版升级变化，上面的 `ls` 会取到当前那个。

### 改 `register.tsx` 时的一条硬规则

引擎加载 mod 前会**静态扫描**模块用了哪些接口方法，扫描的规则是：**`$` 只能递给本文件顶层声明的函数**（`function` 声明，或顶层 `const` 绑定的函数），或者从本模块自己的文件 import 进来的函数。

递给嵌套函数就扫不到，**整个模块会被拒绝加载** —— 而且是静默的：会话照常开始、不报错，只是这个 mod 一个钩子都没注册，界面上什么都不出现。

```js
// ✘ 嵌套在 register 里：扫描扫不到，整个模块不加载
export const register = (on, options) => {
  async function refreshBalance($) { ... }
  on('session.start', async ($, e, next) => { await refreshBalance($); return next(e) })
}

// ✅ 提到顶层，配置显式传参
async function refreshBalance($, cfg) { ... }
export const register = (on, options) => {
  const cfg = readSettings(options)
  on('session.start', async ($, e, next) => { await refreshBalance($, cfg); return next(e) })
}
```

`claude plugin validate <目录>` 会报出这个错误，改完也用它确认 —— 校验通过时它会列出模块登记的钩子和调用的接口（`$.http.fetch (via refreshBalance)` 这种带来源的清单）。

---

## 调研来源

本插件的设计参考了 [BLYHFL/ccplugin-deepseek-hud](https://github.com/BLYHFL/ccplugin-deepseek-hud) —— 一个基于 `statusLine` 的终端 HUD。它的余额查询逻辑（`GET /user/balance`、缓存策略、活跃度检测）很有参考价值；但它只能在终端工作，因为 statusLine 这条路本身不通向 Desktop。本插件把数据获取的思路保留下来，把呈现层换成了跨 surface 的渲染钩子。

- [DeepSeek API — Get User Balance](https://api-docs.deepseek.com/api/get-user-balance)
- [DeepSeek API — Pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)
- [Claude Code — Mods reference](https://code.claude.com/docs/en/plugins/mods/reference)
- [Claude Code — Plugin manifest reference](https://code.claude.com/docs/en/plugins/manifest-reference)

## License

MIT
