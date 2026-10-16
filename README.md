# deepseek-cost-hud

**Claude Code 的 DeepSeek 余额 / 花费 HUD，一份代码同时跑在终端和桌面端。**

```
DeepSeek  ¥86.33  ·  ████░░░░░░ 42.0% ¥1  ·  ↑125.3k ↓54.4k ≈¥1.42   隐藏
```

这一行横条画在输入框正上方：Claude Code 命令行里是终端底部那条带子，Claude Desktop 里是同一个位置的横条。用的是同一份代码、同一个渲染钩子。

**只在认出来是 DeepSeek 模型时才出现** —— 新会话默认不显示，模型不是 DeepSeek（比如走别的网关时的 `glm-5.3`）就一直不显示，那一轮的 token 也不进账。

横条上四段：

| 段 | 含义 |
|---|---|
| `¥86.33` | 账户余额，**接口返回的真实值**。颜色随余额高低变化 |
| `████░░░░░░ 42.0% ¥1` | 本会话**估算花费**的进度条。每满 ¥1 归零重来，走满的每一元换来**一次抽奖机会**（见[抽奖与图鉴](#抽奖与图鉴)） |
| `↑125.3k ↓54.4k` | 本会话输入 / 输出 token，**每轮 API 报告的真实计数** |
| `≈¥1.42` | 本会话估算花费，`≈` 表示它是折算出来的 |

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

token 数 × 单价，逐轮结算：每一轮按**它自己的模型**选单价，再按**那一刻**属于高峰还是错峰折算，所以混合模型的会话、跨时段的长会话都能各算各的，而不是拿一套价乘全部。

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

三种方式，按推荐顺序。

### 1. 在会话里填：`/deepseek-key`，或者直接在横条上填（推荐，桌面端也能用）

**最省事的：横条自己会让你填。** 余额拿不到的时候（没配 Key，或 Key 不对），横条上**就地**出现一个输入框 —— 粘贴 Key 回车就存进钥匙串，存好之后输入框自动消失、余额立刻出来：

```
DeepSeek  HTTP 401  ·  [粘贴 Key 回车存入钥匙串]  ·  ░░░░░░░░░░ 0.0% ¥1    隐藏
```

（终端里要先聚焦那条带子才能输入：`ctrl+x tab`；桌面端点一下即可。）

也可以显式跑一条命令，开一个专门的说明面板：

```
/deepseek-key
```

两条路都写同一处 —— **macOS 钥匙串**：永久有效、不是明文、不进会话记录（不经提示符，也不会被记进 transcript）。

> **为什么绕这么一圈**：mods API 里**没有**任何一条能写系统凭据库 —— `$.store` 是明文 JSON、`$.fs` 是明文文件、`$.env.set` 只作用于进程。而引擎自己那套会写钥匙串的 userConfig 表单，只存在于**终端版 Claude Code 的 `/plugin` 面板**里；桌面端没有终端 UI，插件也画不进应用的设置窗口。所以插件只能借 macOS 自带的 `security` 命令自己存取钥匙串。
>
> **代价如实说**：**仅 macOS**。Windows / Linux 上 `security` 不存在，这条路会失败 —— 失败时给的是明确提示（"这台机器上没有 security 命令"），不是原始报错；那边请用下面第 2、3 种。；写入的那一瞬，key 会作为参数出现在进程列表里 —— 只有同一用户能看到，窗口极短。
>
> 注意这是插件自己的钥匙串条目（服务名 `deepseek-cost-hud`），不是引擎的配置，所以 `/plugin` 的 Configure options 里看不到它。两条都配了的话**以引擎那份为准**（它是 `resolveKey` 的第一优先级）。
>
> **为什么不用引擎自己的凭据库**：读的时候就在用 —— `cfg.apiKey` 是第一优先级。卡住的是**写**：mods API 里没有"写系统凭据库"这条方法，`$.config.set` 只认 `/config` 的行，而敏感字段**不建行**（引擎刻意的：密钥只经它自己的 trusted 路径写入）。顺带一个发现：引擎自己在 macOS 上**也是调 `security add-generic-password`**（Windows 上用 `cmdkey`）—— 存储设施跟这里用的完全一样，差别只是"谁在调"。所以这不是换了个存储，而是插件绕过引擎的写入策略，代价就是失去跨平台能力。

### 2. 终端里一条命令（写进引擎自己的凭据库）

桌面版自带 Claude Code，不需要另装 CLI：

```bash
CLI=$(ls ~/Library/Application\ Support/Claude*/claude-code/*/*/claude.app/Contents/MacOS/claude | tail -1)
read -s KEY; echo; printf '{"apiKey":"%s"}' "$KEY" | "$CLI" plugin configure deepseek-cost-hud@ccplugin-deepseek-cost --values-stdin; unset KEY
```

`read -s` 让 key 输入时不显示、也**不进 shell 历史**；值经 **stdin** 进引擎，写进钥匙串。终端版 Claude Code 用户还可以直接用 `/plugin` → **Installed** → **Configure options** 那个表单。

### 3. 环境变量（兜底）

| 变量 | 说明 |
|---|---|
| `DEEPSEEK_API_KEY` | 最省事的无界面方案。注意**桌面版从 Finder 启动时不继承 shell 环境**，所以它对终端会话更有效；桌面端要持久就用 `~/.claude/settings.json` 的 `env` 块（明文） |
| `ANTHROPIC_AUTH_TOKEN` | ⚠️ 只在里面放的是**真的 DeepSeek API Key** 时才有用。走 cc-switch 之类**代理模式**时那里是本地代理令牌（`ccs-...`），打官方接口必然 401 |

### 查找顺序

```
插件配置 apiKey  →  钥匙串（/deepseek-key 存的）  →  DEEPSEEK_API_KEY  →  ANTHROPIC_AUTH_TOKEN
```

钥匙串那份每个会话只查一次（不会每 60 秒去起进程）。

## 命令

| 命令 | 作用 |
|---|---|
| `/deepseek-cost` | 本会话用量明细与估算花费，含进度条位置 |
| `/deepseek-hud` | 显示 / 隐藏横条 |
| `/deepseek-refresh` | 立刻刷新余额 |
| `/deepseek-draw` | 用攒下的次数抽一次奖（像素转盘） |
| `/deepseek-dex` | 看抽奖图鉴：各档收集进度与已抽到的物品 |
| `/deepseek-key` | 设置 DeepSeek API Key（写进 macOS 钥匙串，永久且非明文） |

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

每花满 ¥1 得**一次抽奖机会**。次数和图鉴存在宿主的 `$.store` 里，**跨会话共享** —— 在任意会话里花掉的 token 攒下的次数，都能在任意会话里抽。

```
/deepseek-draw    抽一次：像素转盘转起来，停在抽中的档位上
/deepseek-dex     图鉴：各档收集进度 + 已经抽到过哪些
```

两个命令都会开一个**面板**（终端、Desktop、VS Code 都支持），面板放不下时退回文本，信息不丢。**次数是攒着的，不会自动弹** —— 你想抽的时候自己跑命令。

### 五个档位与 100 件物品

| 档位 | 颜色 | 概率 | 件数 | 单件价值 |
|---|---|---|---|---|
| 普通 | 蓝 | 79.923% | 70 | ≈¥1（抽纸、回形针、一颗糖…） |
| 稀有 | 紫 | 15.985% | 15 | ≈¥5（一杯奶茶、一份煎饼、一双棉袜…） |
| 罕见 | 粉 | 3.197% | 8 | ≈¥10（一份外卖、一张电影票、一个充电宝…） |
| 史诗 | 红 | 0.639% | 5 | ≈¥100（一副蓝牙耳机、一只机械键盘、一瓶香水…） |
| 传说 | 金 | 0.256% | 2 | ≈¥1000（一部智能手机、一台掌上游戏机） |

抽一次是**三段**，和转盘上看到的完全一致：

1. **按上表的概率生成 6 个色块** —— 所以大概率整盘一片蓝（六块全普通的盘面占 **26%**）
2. **指针在 6 个色块上等概率落点**，落到哪块就取哪块
3. 从该档的物品里等概率取一件

有效概率正好等于上表 —— 因为 `P(中 t 档) = Σᵢ (1/6) × P(第 i 块是 t 档) = p_t`。所以"转盘上大概率是蓝的"和"实际大概率抽到普通"是同一件事。用真实代码跑 20 万次抽奖的实测分布：

| 档位 | 目标 | 实测 | 偏差 |
|---|---|---|---|
| 普通 | 79.923% | 79.939% | +0.0% |
| 稀有 | 15.985% | 15.966% | −0.1% |
| 罕见 | 3.197% | 3.185% | −0.4% |
| 史诗 | 0.639% | 0.671% | +5.1%（小样本噪声，期望次数约 1278） |
| 传说 | 0.256% | 0.238% | −6.8%（小样本噪声，期望次数约 512） |

> 早先的实现是**五等分扇区**、直接按概率把指针停到对应扇区。指针落点虽然是对的，但**盘面本身在骗人**：五等分等于宣称五档概率相同，跟 79.9% 对 0.256% 的表完全不是一回事 —— 看一眼转盘会以为传说有 20% 的机会。现在盘面就是按概率生成的结果，一眼就能看出这一盘大概值多少。

### 动画是怎么做到不骗人的

转盘用像素色块拼成（11×11 的圆环，六等分扇区，每块一个色块），指针画在正上方。**抽奖结果先定、先落库，旋转角度再由结果反推**，所以终帧的指针必然停在中奖那一块上 —— 动画只负责演，不参与随机。

也因此：面板放不下（终端太窄之类）时不会丢东西，只是不播动画，命令照样把结果告诉你。

画法上有一点是硬约束：引擎的渲染元素里只有 `Box` / `Text` 在终端和 Desktop 上**都**支持 `backgroundColor`（`Raster` 只有终端、`Svg` 只有 Desktop），所以转盘只能用它们拼、只写这一份。

还有一个只在修 bug 时才会发现的坑：**色块不要用普通空格填**。终端的空格一格一格占位，底色正好透出来；但桌面端的渲染器会把**连续普通空格折叠掉**，11 格宽的圆环会被压成两三格（真出现过：侧栏里的转盘是扁的）。所以桌面端用不换行空格 ` `，终端才用普通空格 —— 见 `cellFill()`。

---

## 配置项

改配置**只有终端一条路**（原因见上面「配置 API Key」那节的查证）：

| 想改什么 | 怎么改 |
|---|---|
| **API Key** | 会话里 `/deepseek-key`（推荐，桌面端也能用）；或终端里 `claude plugin configure … --values-stdin`。两条都不落明文 |
| 其它任何一项（开关、单价、币种…） | 同一条命令（`--values-stdin` 传 `{"priceOutput": 9}` 这样的 JSON），或终端会话里的 `/plugin` → **Installed** 标签 → **Configure options** |
| 不想用命令 | 手改 `~/.claude/settings.json` 的 `pluginConfigs`，键是**插件 id**：`"deepseek-cost-hud@ccplugin-deepseek-cost": { "options": { "showCycle": false } }`。**敏感值不要走这里** —— 引擎只从系统凭据库读敏感值 |

> 改完要**重开一个会话**（终端里 `/reload-plugins`）才生效 —— 配置是插件加载时一次性读走的。
>
> 试过在会话内画一个配置面板（`$.config.list()` / `$.config.set()` 都可用）：它改不了 Key（敏感字段没有 `/config` 行），能改的那几项本来一条命令就能解决，反而多一份要维护的界面，所以删掉了。

配置项一览：

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

### 按模型计价

花费是按**每一轮的模型**折算的，单价来自插件内置的官方人民币高峰价表：

| 模型 | 缓存命中 | 缓存未命中 | 输出 |
|---|---|---|---|
| `deepseek-flash` | 0.04 | 2 | 8 |
| `deepseek-v4-pro` | 0.30 | 9 | 27 |

错峰一律减半（flash 错峰即 0.02 / 1 / 4）。

**配置里那三个单价是兜底**，只在模型不在上表时生效 —— 比如别的 `deepseek-*` 变体。表里已有的模型改配置不起作用，这是有意的：价目是官方定的，不该被误配置悄悄覆盖。

模型 id **只从每轮响应的 `model` 里认** —— 那是上游真名。

> 为什么不用 `$.session.model()`：它给的是映射**前**的客户端模型名。走 cc-switch 这类网关时你会拿到 `claude-haiku-4-5[1m]` 这种，拿去判断"是不是 DeepSeek"必然判错（这个坑踩过：横条会被误判成非 DeepSeek 而不显示）。

认到的模型会记进 `$.store` 的 `lastModel`，所以**新会话不用等第一轮回答**就能判断；只有这台机器第一次跑时要等一轮。中途切模型依然会跟着变。

---

## 计价是怎么处理的

### 按模型

见上表。非 DeepSeek 的模型（比如走别的网关时的 `glm-5.3`）**不计价，横条也不显示** —— 拿 DeepSeek 的价目折算别的模型没有意义。

### 按时段

DeepSeek 官方价目把一天切成两档（据官方 API 文档 *Pricing* 页）：

- **高峰**：UTC 周一至周五 `01:00–04:00` 与 `06:00–10:00`（北京时间 `09:00–12:00`、`14:00–18:00`）
- **错峰**：其余全部时段 —— 含整个周末 —— 错峰价 = **高峰价的一半**

插件**逐轮结算**：每一轮 `turn.complete` 到达时，先按那一轮的模型选单价，再按那一刻属于哪一档折算，然后加进累计值。所以混合模型、跨高峰与错峰的长会话，每一轮都会用自己该用的价。

> **已知不足**：官方口径里"中国法定节假日全天算错峰"，而这里只判了周末，没有节假日数据表。所以法定节假日当天估算会偏高一点。

---

## 已知边界

- **价目表是内置的、按模型查**：新模型上线要更新插件，或者把它的单价填进那三个兜底配置（改名成新模型即可生效 —— 内置表里没有它）。
- **非 DeepSeek 的轮次一概不显示也不计价**：横条只讲 DeepSeek 的花费。一条会话里混用别的模型时，只有 DeepSeek 那些轮次进账。
- **节假日未识别**：见上。
- **子 agent 的消耗计入总数**：`turn.complete` 对子 agent 的轮次同样触发，那确实是真花掉的钱，所以计入。
- **余额币种与估算币种不一致时**：两边各自按自己的币种显示，不做换算。人民币账户配人民币价目就一致。
- **刷新失败时报错优先于缓存**：上一个成功抓到的余额会被缓存起来铺首屏，但一旦刷新失败，横条会显示错误（并把旧数字标成"缓存¥…"），不会拿旧数字冒充当前余额 —— 否则连"该配 Key 了"都看不出来。
- **余额需要 Key 能通**：Key 拉不到余额时，余额那一栏显示失败原因（如 `HTTP 401`），进度条和 token 仍然照常工作 —— 它们不依赖网络。
- **抽奖账本没有原子写**：`$.store` 只有读改写、没有 CAS（`$.state` 才有 `ifVersion`），所以多个会话**同一瞬间**同时抽奖理论上会丢一次更新。写入方只有"每轮自动累加"和"手动抽一次"两类，都是人速节奏，撞车窗口是毫秒级，所以没有为它引入更复杂的结构。
- **物品表是内置的**：加物品、改概率要改代码发版，配置里改不了。
- **动画帧率受引擎节流**：重绘上限约 10/s，终端里面板被显示时可到 30/s。所以桌面端的转盘会比终端顿一些，这是引擎的上限，绕不过去。

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
  register.tsx       主体逻辑：计价、横条、命令、抽奖接线
  gacha-items.ts     抽奖的档位与 100 件物品（含纯函数 rollItem）
  gacha-wheel.ts     像素转盘的几何与配色（纯函数，可单测）
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
