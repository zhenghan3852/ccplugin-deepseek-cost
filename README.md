# deepseek-cost-hud

**Claude Code 的 DeepSeek 余额 / 花费 HUD，一份代码同时跑在终端和桌面端。**

```
DeepSeek  ¥86.33  ·  ████░░░░░░ 42.0% ¥1  ·  ↑125.3k ↓54.4k ≈¥1.42   隐藏
```

这一行横条画在**输入框正上方**：Claude Code 命令行里是终端底部那条带子，Claude Desktop 里是同一个位置的横条。

**只在认出来是 DeepSeek 模型时才出现** —— 新会话默认不显示，模型不是 DeepSeek（比如走别的网关时的 `glm-5.3`）就一直不显示，那一轮的 token 也不进账。

---

## 横条上有什么

| 段 | 含义 |
|---|---|
| `¥86.33` | 账户余额，**接口返回的真实值**。颜色随余额高低变化 |
| `████░░░░░░ 42.0% ¥1` | **本机累计**花费的进度条（所有会话加起来）。每满 ¥1 归零重来，走满的每一元换来**一次抽奖机会** |
| `↑125.3k ↓54.4k` | 本会话输入 / 输出 token，**每轮 API 报告的真实计数** |
| `≈¥1.42` | 本会话估算花费，`≈` 表示它是折算出来的 |

右下角 `隐藏` 可以收起整条。

## 功能

- **账户余额** —— 直接查 DeepSeek `/user/balance`，实时刷新，不是估算
- **花费进度条** —— 本机所有会话累计，每满 ¥1 归零，同时攒一次抽奖机会
- **本会话用量** —— 每轮 API 上报的真实 token 数，按模型和时段折算成钱
- **6 条命令** —— 明细、隐藏/显示、刷新、抽奖、图鉴、设置 Key（见下）
- **抽奖与图鉴** —— 5 个档位、100 件物品，次数跨会话共享。详见 [技术文档](docs/TECHNICAL.md#抽奖与图鉴)
- **桌面端可用** —— 不是终端专属的状态栏，横条在两个端都渲染

---

## 安装

> 两条路都建议选 **user 作用域**。桌面端只加载 user 作用域的插件。

### 命令行端（Claude Code CLI）

在**终端**里运行 Claude Code，然后：

```
/plugin install deepseek-cost-hud --marketplace zhenghan3852/ccplugin-deepseek-cost
```

提示 `Add marketplace?` 时答 `y`，作用域选 **user**。

装完这一条命令就会生效。之后改了插件的代码，用 `/reload-plugins` 重载，或重开一个会话。

### 桌面端（Claude Desktop）

桌面版 Code 标签页**不接受** `/plugin install` 这条命令，所以要到终端里装一次：

1. 打开终端，运行 `claude`（命令行版）
2. 执行上面的 `/plugin install …`，作用域选 **user**
3. 回到 Claude Desktop，重开一个会话

桌面端的本地会话会一并加载 user 作用域的插件，它的渲染钩子会以 `desktop` surface 绘制 —— 横条就出现在输入框上方。

---

## 配置 API Key

**横条自己会让你填。** 余额拿不到的时候（没配 Key，或 Key 不对），横条上**就地**出现一个输入框 —— 粘贴 Key 回车就存好，存好之后输入框自动消失、余额立刻出来：

```
DeepSeek  HTTP 401  ·  [粘贴 Key 回车保存（明文）]  ·  ░░░░░░░░░░ 0.0% ¥1    隐藏
```

终端里要先聚焦那条带子才能输入：`ctrl+x tab`；桌面端点一下即可。

也可以显式跑一条命令，开一个带说明的面板：

```
/deepseek-key
```

### 桌面端

用上面的横条输入框，或 `/deepseek-key`。这是桌面端唯一方便的路 —— 桌面版从 Finder 启动时不继承 shell 环境变量。

> ⚠️ 这条写的是**明文**（`~/.claude/plugins/store/<插件 id>.json`，权限 0600）。这是刻意的取舍：mods API 里没有"写凭据库"这条方法，想同时做到"会话内直接填"和"跨平台"就只能写明文文件。换来的是永久有效、不进会话记录、不用开终端、三平台一样。

### 命令行端

CLI 用户有更好的路，**不必用明文**：终端会话里 `/plugin` → **Installed** 标签 → 选中插件 → **Configure options** —— 那条路把 Key 存进**系统凭据库**（macOS 钥匙串 / Windows 凭据管理器）。等价的无界面写法：

```bash
echo '{"apiKey":"sk-xxxxxxxx"}' | claude plugin configure deepseek-cost-hud@ccplugin-deepseek-cost --values-stdin
```

### 环境变量（兜底）

| 变量 | 说明 |
|---|---|
| `DEEPSEEK_API_KEY` | 无界面方案。桌面版不继承 shell 环境，所以它对终端会话更有效 |
| `ANTHROPIC_AUTH_TOKEN` | ⚠️ 只在里面放的**真的是 DeepSeek API Key** 时才有用。走 cc-switch 之类**代理模式**时那里是本地代理令牌（`ccs-...`），打官方接口必然 401 |

### 查找顺序

```
插件配置 apiKey  →  插件存储（明文）  →  DEEPSEEK_API_KEY  →  ANTHROPIC_AUTH_TOKEN
```

**两条都配了以引擎那份为准**（它是第一级）。

---

## 命令

| 命令 | 作用 |
|---|---|
| `/deepseek-cost` | 本会话用量明细与估算花费，含进度条位置 |
| `/deepseek-hud` | 显示 / 隐藏横条 |
| `/deepseek-refresh` | 立刻刷新余额 |
| `/deepseek-draw` | 打开抽奖面板：看到还剩几次，点面板上的按钮才开始抽 |
| `/deepseek-dex` | 看抽奖图鉴：各档收集进度与已抽到的物品 |
| `/deepseek-key` | 设置 DeepSeek API Key |

`/deepseek-cost` 的样子：

```
余额        ¥86.33（充值 68.81 + 赠送 17.52）
模型        deepseek-flash   （内置高峰价 2 / 0.04 / 8 元每百万 token，错峰减半）
本会话估算  ¥1.42   （进度条 42.0%，每满 ¥1 得一次抽奖）
token       ↑125.3k（缓存命中 15.7M / 未命中 125.3k）  ↓54.4k   共 5 轮
缓存命中率  99.2%
当前计价    高峰
```

进度条每满 ¥1 就归零，所以**想看本会话总共花了多少，只能在这里看**。

---

## 抽奖与图鉴

本机累计每花满 ¥1 得**一次抽奖机会**。次数和图鉴**跨会话共享** —— 在任意会话里花掉的钱攒下的次数，都能在任意会话里抽。

| 档位 | 颜色 | 概率 | 件数 | 单件价值 |
|---|---|---|---|---|
| 普通 | 蓝 | 79.923% | 70 | ≈¥1 |
| 稀有 | 紫 | 15.985% | 15 | ≈¥5 |
| 罕见 | 粉 | 3.197% | 8 | ≈¥10 |
| 史诗 | 红 | 0.639% | 5 | ≈¥100 |
| 传说 | 金 | 0.256% | 2 | ≈¥1000 |

**抽奖不会被命令替你按下去**：`/deepseek-draw` 只负责开门，面板上先告诉你还剩几次，要**点「开始抽奖」**才真的开抽。面板放不下（窗口太窄）时会告诉你去放宽一点，**不会偷抽**。转盘的盘面是按概率真实生成的，动画只负责演、不参与随机 —— 细节见[技术文档](docs/TECHNICAL.md#抽奖与图鉴)。

---

## 配置项

| 配置 | 默认 | 说明 |
|---|---|---|
| `apiKey` | — | DeepSeek API Key（sensitive，存进系统凭据库） |
| `refreshSeconds` | `60` | 余额刷新间隔（秒） |
| `showBalance` | `true` | 显示余额 |
| `showCycle` | `true` | 显示花费进度条 |
| `showUsage` | `true` | 显示 token 用量与估算花费 |
| `balanceApiBase` | `https://api.deepseek.com` | 余额接口地址 |
| `priceCurrency` | `CNY` | 估算值的货币符号 |
| `priceInput` | `2` | **兜底**输入价 / 百万 token，缓存未命中，高峰价 |
| `priceCacheRead` | `0.04` | **兜底**输入价 / 百万 token，缓存命中，高峰价 |
| `priceOutput` | `8` | **兜底**输出价 / 百万 token，高峰价 |
| `offPeakDiscount` | `50` | 错峰折扣（%），即错峰价 = 高峰价的 50% |

`priceCurrency` 必须和单价币种一致。余额那一栏不受它影响 —— 永远用接口返回的币种。

**改配置只有终端一条路**：

```bash
echo '{"priceOutput":9}' | claude plugin configure deepseek-cost-hud@ccplugin-deepseek-cost --values-stdin
```

或终端会话里 `/plugin` → **Installed** → **Configure options**。手改 `~/.claude/settings.json` 的 `pluginConfigs` 也可以（键是插件 id），但**敏感值不要走那里**。

> 改完要**重开一个会话**（终端里 `/reload-plugins`）才生效 —— 配置是插件加载时一次性读走的。

---

## 开发

```bash
npm install
npm run typecheck   # tsc -p .
npm run validate    # claude plugin validate .
npm run test        # claude plugin test .
```

想从源码跑：`claude --plugin-dir .`（这个目录会被监视，改完存盘即重载）。

架构、数据真伪分级、计价口径、抽奖实现、`$` 顶层函数硬规则、已知边界 —— 都在 **[docs/TECHNICAL.md](docs/TECHNICAL.md)**。

## License

MIT
