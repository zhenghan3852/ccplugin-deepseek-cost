# deepseek-cost-hud

**Claude Code 的 DeepSeek 余额 / 用量 HUD，一份代码同时跑在终端和桌面端。**

```
DeepSeek  ¥40.36  ·  ██████░░░░ 45% 1M  ·  ↑12.3k ↓4.5k 实测¥0.36(估$0.03)   [隐藏]
```

这一行横条画在输入框正上方：Claude Code 命令行里是终端底部那条带子，Claude Desktop 里是同一个位置的横条。用的是同一份代码、同一个渲染钩子。

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

另外还用 `$.ui.status` 顶了一条单行摘要，这样在终端里把带子折叠掉（`ctrl+x ctrl+a`）之后，余额仍然留在屏幕上。

---

## 数据从哪来：哪些是实测，哪些是估算

这三件事的确定性完全不同，插件也把它们分得清清楚楚：

### 余额 —— 实测，来自 DeepSeek 接口

```
GET https://api.deepseek.com/user/balance
Authorization: Bearer <你的 API Key>
```

返回账户里真正剩下的钱。**这是权威值，不是估算。**

### 本会话消耗 —— 实测，来自余额差额

会话第一次读到余额时把总额记成基准，之后每次刷新再读一次，**两者之差就是这段会话真实花掉的钱**。

这个数字的好处是它自动包含了 DeepSeek 给的一切优惠 —— 错峰折扣、赠送额度抵扣，全都不用我们建模。

> 前提：这把 API Key 在会话期间没有别的程序在并发消费。有的话差额会偏大。

### token 用量 —— 实测计数，来自每轮 API 响应

每轮 `turn.complete` 事件带回来该轮真实请求的 token 数，逐轮累加得到本会话的总用量。

**注意**：DeepSeek 官方 API Reference 里只有 `Chat Completions`、`Responses`、`FIM Completion (Beta)`、`Lists Models`、`Get User Balance`、`Files` 这几组接口 —— **没有**任何查询用量、账单或消费记录的接口。所以"用量"只能这样从响应里攒，没有第二条路。

### 估算花费 —— 估算，仅作对照

只有前两类都拿不到时才启用，且前面标 `≈`。它按可配置单价折算，用途是**验证估算准不准**：

```
/deepseek-cost

余额        ¥40.36（充值 30.00 + 赠送 10.36）
会话起始    40.72 CNY
实测消耗    ¥0.36   （余额差额，含官方一切折扣）
估算消耗    $0.03   （偏差 -8.3%）
token       ↑12.3k（缓存命中 9.1k / 未命中 3.2k）  ↓4.5k   共 8 轮
缓存命中率  74.0%
当前计价    错峰（高峰价的 50%）
```

把实测和估算摆在一起，偏差一目了然 —— 这就是"用余额校验估算"的用法。偏差持续偏大，说明单价配错了，照着改 `priceInput` / `priceOutput` 即可。

---

## 安装

### 从 GitHub 安装（推荐）

在**终端**里运行 Claude Code，然后：

```
/plugin install deepseek-cost-hud --marketplace zhenghan3852/ccplugin-deepseek-cost
```

提示 `Add marketplace?` 时答 `y`，选 **user 作用域**。

> **想在 Claude Desktop 里也用，就必须在终端装、且选 user 作用域。** Desktop 自己的 Code 标签页不接受 `/plugin install` 这条命令；但从终端装到 user 作用域的插件，Desktop 的本地会话会一并加载，它的 `ui.render` 钩子会以 `desktop` surface 绘制。

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
4. 环境变量 `ANTHROPIC_AUTH_TOKEN`（用 cc-switch 之类把 Claude Code 路由到 DeepSeek 时，key 在这里）

最省事的是第 3 种：

```bash
export DEEPSEEK_API_KEY="sk-xxxxxxxxxxxxxxxx"
```

---

## 命令

| 命令 | 作用 |
|---|---|
| `/deepseek-cost` | 用量明细，实测 vs 估算对照 |
| `/deepseek-hud` | 显示 / 隐藏横条 |
| `/deepseek-refresh` | 立刻刷新余额 |
| `/deepseek-key [sk-...]` | 保存 API Key |

---

## 配置项

在 `/plugin` 或 `/config` 里改，也可以写进 `settings.json` 的 `pluginConfigs`。

| 配置 | 默认 | 说明 |
|---|---|---|
| `apiKey` | — | DeepSeek API Key（sensitive，存进系统凭据库） |
| `refreshSeconds` | `60` | 余额刷新间隔（秒） |
| `showBalance` | `true` | 显示余额 |
| `showContext` | `true` | 显示上下文占用进度条 |
| `showUsage` | `true` | 显示 token 用量与花费 |
| `showEstimate` | `true` | 在实测消耗旁并列显示估算值 |
| `balanceApiBase` | `https://api.deepseek.com` | 余额接口地址 |
| `priceCurrency` | `USD` | 单价与估算值的货币 |
| `priceInput` | `0.30` | 输入价 / 百万 token，缓存未命中，**高峰价** |
| `priceCacheRead` | `0.006` | 输入价 / 百万 token，缓存命中，**高峰价** |
| `priceOutput` | `1.20` | 输出价 / 百万 token，**高峰价** |
| `offPeakDiscount` | `50` | 错峰折扣（%），即错峰价 = 高峰价的 50% |

价格默认值取 **`deepseek-flash`** 的官方高峰价。用 `deepseek-v4-pro` 的话改成 `1.32` / `0.044` / `3.96`。

---

## 错峰计价是怎么处理的

DeepSeek 官方价目把一天切成两档（据官方 API 文档 *Pricing* 页）：

- **高峰**：UTC 周一至周五 `01:00–04:00` 与 `06:00–10:00`（北京时间 `09:00–12:00`、`14:00–18:00`）
- **错峰**：其余全部时段 —— 含整个周末 —— 错峰价 = **高峰价的一半**

插件**逐轮结算**：每一轮 `turn.complete` 到达时就地判断那一刻属于哪一档，用对应单价折算那一轮，再加进累计值。所以一条跨了高峰和错峰的长会话，会自动把两种价都算进去，而不是拿一个价乘全部。

> **已知不足**：官方口径里"中国法定节假日全天算错峰"，而这里只判了周末，没有节假日数据表。所以法定节假日当天估算会偏高一点。实测值（余额差额）不受影响 —— 它把任何折扣都算进去了。这也正是以实测为准、估算仅作对照的原因。

---

## 已知边界

- **余额差额依赖独占**：会话期间别的程序用同一把 key 消费，实测值会偏大。
- **节假日未识别**：见上。
- **子 agent 的消耗计入总数**：`turn.complete` 对子 agent 的轮次同样触发，那确实是真花掉的钱，所以计入。
- **多币种不混算**：余额币种与 `priceCurrency` 不同时，只并列显示，不给偏差百分比。
- **估算需要单价正确**：单价是用户配置的，不是插件去网上抓的。

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
types/
  index.d.ts         $.state 的类型契约
```

`tsconfig.json` 里 `typeRoots` 指向 `.claude-plugin/types/` —— 那是引擎在加载插件时自己写入的类型声明目录（每个 Claude Code 版本重写一次），已加进 `.gitignore`。本地首次类型检查前，先用 `claude --plugin-dir .` 加载一次插件让它生成。

---

## 调研来源

本插件的设计参考了 [BLYHFL/ccplugin-deepseek-hud](https://github.com/BLYHFL/ccplugin-deepseek-hud) —— 一个基于 `statusLine` 的终端 HUD。它的余额查询逻辑（`GET /user/balance`、缓存策略、活跃度检测）很有参考价值；但它只能在终端工作，因为 statusLine 这条路本身不通向 Desktop。本插件把数据获取的思路保留下来，把呈现层换成了跨 surface 的渲染钩子。

- [DeepSeek API — Get User Balance](https://api-docs.deepseek.com/api/get-user-balance)
- [DeepSeek API — Pricing](https://api-docs.deepseek.com/quick_start/pricing)
- [Claude Code — Mods reference](https://code.claude.com/docs/en/plugins/mods/reference)
- [Claude Code — Plugin manifest reference](https://code.claude.com/docs/en/plugins/manifest-reference)

## License

MIT
