/**
 * 抽奖的物品表：5 个档位、100 件生活常见物。
 *
 * 两件事分开：
 *   档位概率  决定"先按概率生成品质"这一步 —— 见 `TIERS` 的 `chance`。
 *   档内均匀  决定"再从该品质里随机拿一件" —— 见 `rollItem` 的第二次取值。
 * 所以单件物品的实际概率 = 该档概率 ÷ 该档件数。
 *
 * 颜色一律用 Ink 的颜色名，不用十六进制：终端渲染器认名字，而"不认识的
 * 颜色画成什么"是各 surface 自己的事 —— 像素转盘整个靠颜色说话，不能赌。
 */

import type { TierId } from '../types'

export type Tier = {
  id: TierId
  /** 中文档位名，上屏用 */
  name: string
  /** Ink 颜色名 */
  color: string
  /** 概率，五档之和必须等于 1 */
  chance: number
  /** 该档物品的大概价值，纯展示 */
  value: string
}

/** 高概率在前：`rollItem` 按这个顺序累加区间。 */
export const TIERS: readonly Tier[] = [
  { id: 'common', name: '普通', color: 'blue', chance: 0.79923, value: '≈¥1' },
  { id: 'rare', name: '稀有', color: 'magenta', chance: 0.15985, value: '≈¥5' },
  { id: 'uncommon', name: '罕见', color: 'magentaBright', chance: 0.03197, value: '≈¥10' },
  { id: 'epic', name: '史诗', color: 'red', chance: 0.00639, value: '≈¥100' },
  { id: 'legendary', name: '传说', color: 'yellow', chance: 0.00256, value: '≈¥1000' },
]

export type Item = {
  /** 稳定 id，存进图鉴的就是它 */
  id: string
  name: string
  tier: TierId
}

/** 70 + 15 + 8 + 5 + 2 = 100 件。 */
export const ITEMS: readonly Item[] = [
  // ── 普通 70 件：日用小物 ────────────────────────────────────────────
  { id: 'tissue', name: '一包抽纸', tier: 'common' },
  { id: 'paperclip', name: '一枚回形针', tier: 'common' },
  { id: 'rubber-band', name: '一根橡皮筋', tier: 'common' },
  { id: 'pencil', name: '一支铅笔', tier: 'common' },
  { id: 'candy', name: '一颗水果糖', tier: 'common' },
  { id: 'water', name: '一瓶矿泉水', tier: 'common' },
  { id: 'egg', name: '一个鸡蛋', tier: 'common' },
  { id: 'scallion', name: '一根小葱', tier: 'common' },
  { id: 'salt', name: '一包盐', tier: 'common' },
  { id: 'bandage', name: '一片创可贴', tier: 'common' },
  { id: 'plastic-bag', name: '一个塑料袋', tier: 'common' },
  { id: 'toothpick', name: '一根牙签', tier: 'common' },
  { id: 'sticky-note', name: '一张便签', tier: 'common' },
  { id: 'eraser', name: '一块橡皮', tier: 'common' },
  { id: 'ruler', name: '一把直尺', tier: 'common' },
  { id: 'tissue-pack', name: '一包纸巾', tier: 'common' },
  { id: 'straw', name: '一根吸管', tier: 'common' },
  { id: 'paper-cup', name: '一个纸杯', tier: 'common' },
  { id: 'button', name: '一粒纽扣', tier: 'common' },
  { id: 'cotton-swab', name: '一根棉签', tier: 'common' },
  { id: 'peanut', name: '一颗花生', tier: 'common' },
  { id: 'preserved-plum', name: '一颗话梅', tier: 'common' },
  { id: 'bottle-cap', name: '一个瓶盖', tier: 'common' },
  { id: 'postcard', name: '一张明信片', tier: 'common' },
  { id: 'ballpoint', name: '一支圆珠笔', tier: 'common' },
  { id: 'matches', name: '一盒火柴', tier: 'common' },
  { id: 'shoelace', name: '一根鞋带', tier: 'common' },
  { id: 'coin', name: '一枚一元硬币', tier: 'common' },
  { id: 'hair-tie', name: '一个发圈', tier: 'common' },
  { id: 'gum', name: '一包口香糖', tier: 'common' },
  { id: 'popsicle', name: '一根冰棍', tier: 'common' },
  { id: 'soda', name: '一罐汽水', tier: 'common' },
  { id: 'soy-milk', name: '一袋豆浆', tier: 'common' },
  { id: 'steamed-bun', name: '一个包子', tier: 'common' },
  { id: 'fried-dough', name: '一根油条', tier: 'common' },
  { id: 'tea-egg', name: '一个茶叶蛋', tier: 'common' },
  { id: 'instant-noodles', name: '一包泡面', tier: 'common' },
  { id: 'sausage', name: '一根火腿肠', tier: 'common' },
  { id: 'chocolate', name: '一块巧克力', tier: 'common' },
  { id: 'spicy-strip', name: '一包辣条', tier: 'common' },
  { id: 'sunflower-seeds', name: '一包瓜子', tier: 'common' },
  { id: 'tangerine', name: '一个橘子', tier: 'common' },
  { id: 'banana', name: '一根香蕉', tier: 'common' },
  { id: 'apple', name: '一个苹果', tier: 'common' },
  { id: 'milk', name: '一盒牛奶', tier: 'common' },
  { id: 'yogurt', name: '一袋酸奶', tier: 'common' },
  { id: 'mantou', name: '一个馒头', tier: 'common' },
  { id: 'corn', name: '一根玉米', tier: 'common' },
  { id: 'sweet-potato', name: '一个红薯', tier: 'common' },
  { id: 'potato', name: '一个土豆', tier: 'common' },
  { id: 'carrot', name: '一根胡萝卜', tier: 'common' },
  { id: 'cabbage', name: '一颗白菜', tier: 'common' },
  { id: 'ginger', name: '一块姜', tier: 'common' },
  { id: 'garlic', name: '一头蒜', tier: 'common' },
  { id: 'tomato', name: '一个番茄', tier: 'common' },
  { id: 'cucumber', name: '一根黄瓜', tier: 'common' },
  { id: 'tofu', name: '一块豆腐', tier: 'common' },
  { id: 'flour', name: '一包面粉', tier: 'common' },
  { id: 'travel-toothpaste', name: '一支旅行装牙膏', tier: 'common' },
  { id: 'wet-wipes', name: '一包湿巾', tier: 'common' },
  { id: 'paper-bag', name: '一个纸袋', tier: 'common' },
  { id: 'candle', name: '一根蜡烛', tier: 'common' },
  { id: 'balloon', name: '一个气球', tier: 'common' },
  { id: 'sticker', name: '一张贴纸', tier: 'common' },
  { id: 'chalk', name: '一支粉笔', tier: 'common' },
  { id: 'folder', name: '一个文件夹', tier: 'common' },
  { id: 'exercise-book', name: '一本作业本', tier: 'common' },
  { id: 'highlighter', name: '一支荧光笔', tier: 'common' },
  { id: 'staple', name: '一个订书钉', tier: 'common' },
  { id: 'rag', name: '一块抹布', tier: 'common' },

  // ── 稀有 15 件：一杯奶茶这一级 ──────────────────────────────────────
  { id: 'milk-tea', name: '一杯奶茶', tier: 'rare' },
  { id: 'jianbing', name: '一份煎饼果子', tier: 'rare' },
  { id: 'beef-noodles', name: '一碗牛肉面', tier: 'rare' },
  { id: 'socks', name: '一双棉袜', tier: 'rare' },
  { id: 'notebook', name: '一本笔记本', tier: 'rare' },
  { id: 'cheap-umbrella', name: '一把折叠伞', tier: 'rare' },
  { id: 'chocolate-box', name: '一盒巧克力礼盒', tier: 'rare' },
  { id: 'phone-case', name: '一个手机壳', tier: 'rare' },
  { id: 'screen-protector', name: '一张钢化膜', tier: 'rare' },
  { id: 'usb-cable', name: '一条数据线', tier: 'rare' },
  { id: 'cheap-earbuds', name: '一副地摊耳机', tier: 'rare' },
  { id: 'egg-tarts', name: '一盒蛋挞', tier: 'rare' },
  { id: 'liangpi', name: '一份凉皮', tier: 'rare' },
  { id: 'cat-food', name: '一袋猫粮', tier: 'rare' },
  { id: 'hand-cream', name: '一支护手霜', tier: 'rare' },

  // ── 罕见 8 件：外卖 / 电影票这一级 ──────────────────────────────────
  { id: 'takeout', name: '一份外卖', tier: 'uncommon' },
  { id: 'movie-ticket', name: '一张电影票', tier: 'uncommon' },
  { id: 'paperback', name: '一本畅销书', tier: 'uncommon' },
  { id: 'power-bank', name: '一个充电宝', tier: 'uncommon' },
  { id: 'cap', name: '一顶棒球帽', tier: 'uncommon' },
  { id: 'scarf', name: '一条围巾', tier: 'uncommon' },
  { id: 'sunglasses', name: '一副太阳镜', tier: 'uncommon' },
  { id: 'marker-set', name: '一盒马克笔', tier: 'uncommon' },

  // ── 史诗 5 件：百元级 ──────────────────────────────────────────────
  { id: 'bluetooth-earbuds', name: '一副蓝牙耳机', tier: 'epic' },
  { id: 'mechanical-keyboard', name: '一只机械键盘', tier: 'epic' },
  { id: 'sneakers', name: '一双正品运动鞋', tier: 'epic' },
  { id: 'perfume', name: '一瓶香水', tier: 'epic' },
  { id: 'buffet', name: '一顿自助餐', tier: 'epic' },

  // ── 传说 2 件：千元级 ──────────────────────────────────────────────
  { id: 'smartphone', name: '一部智能手机', tier: 'legendary' },
  { id: 'handheld-console', name: '一台掌上游戏机', tier: 'legendary' },
]

export const TIER_BY_ID: Record<TierId, Tier> = Object.fromEntries(
  TIERS.map((t) => [t.id, t]),
) as Record<TierId, Tier>

export const ITEM_BY_ID: Record<string, Item> = Object.fromEntries(
  ITEMS.map((i) => [i.id, i]),
)

/** 按档位归拢物品。档位表是唯一来源，所以每个档位都会拿到池子。 */
function groupByTier(items: readonly Item[]): Record<TierId, readonly Item[]> {
  const pools = {} as Record<TierId, readonly Item[]>
  for (const tier of TIERS) {
    pools[tier.id] = items.filter((item) => item.tier === tier.id)
  }
  return pools
}

/** 每档的物品池，抽奖时按档取用。 */
export const ITEMS_BY_TIER = groupByTier(ITEMS)

/** 转盘上的色块数量。 */
export const WHEEL_SLOTS = 6

/**
 * 按档位概率定一档。两次取值里的第一步，抽奖时每个色块都要走一遍。
 * `rand` 必须返回 [0, 1)。
 */
export function pickTier(rand: () => number): TierId {
  const roll = rand()
  let cumulative = 0
  for (const candidate of TIERS) {
    cumulative += candidate.chance
    if (roll < cumulative) return candidate.id
  }
  // 浮点求和可能差最后一点点，落到这里就是最后一档
  return TIERS[TIERS.length - 1]!.id
}

export type Draw = {
  /** 转盘上六个色块各是什么档位 —— 每次抽奖重新生成 */
  slots: readonly TierId[]
  /** 指针落在第几个色块（0 起） */
  winner: number
  /** 中奖色块的档位 */
  tier: TierId
  /** 最终抽到的物品 */
  item: Item
}

/**
 * 抽一次。
 *
 * 机制是三段，和转盘上看到的完全一致：
 *   1. 按档位概率生成 6 个色块 —— 所以大概率整盘都是普通（蓝）
 *   2. 指针在 6 个色块上**等概率**落点，落到哪块就取哪块
 *   3. 从该档的物品里等概率取一件
 *
 * 有效概率正好等于档位概率：P(中 t 档) = Σᵢ (1/6)·P(第 i 块是 t 档) = p_t。
 * 所以"看起来大概率是蓝的"和"实际大概率抽到普通"是同一件事 —— 转盘不撒谎。
 *
 * 随机源注入，能确定性地单测。
 */
export function rollDraw(rand: () => number): Draw {
  const slots = Array.from({ length: WHEEL_SLOTS }, () => pickTier(rand))
  const winner = Math.min(WHEEL_SLOTS - 1, Math.floor(rand() * WHEEL_SLOTS))
  const tier = slots[winner]!
  const pool = ITEMS_BY_TIER[tier]
  const index = Math.min(pool.length - 1, Math.floor(rand() * pool.length))
  // pool 非空由物品表本身保证（测试里也断言了各档件数）
  return { slots, winner, tier, item: pool[index]! }
}
