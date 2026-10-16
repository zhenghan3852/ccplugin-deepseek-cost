/**
 * 像素转盘：把"某一档 + 某一帧"算成一张颜色网格。纯函数，无 `$`，所以能直接单测。
 *
 * 为什么要单独一个文件：这个功能最容易错的地方是**终帧指针到底落在哪一档**。
 * 抽奖结果先定、旋转角度由结果反推，所以"指针下那一格的颜色 === 抽中的档位色"
 * 是一条必须成立的不变量 —— 放在这里，测试里可以直接断言。
 *
 * 颜色用 Ink 的颜色名（见 gacha-items.ts 的说明）。
 */

import type { TierId } from '../types'
import { TIERS } from './gacha-items'

export const WHEEL_SIZE = 11
export const WHEEL_FRAMES = 22
export const WHEEL_TICK_MS = 100
const WHEEL_SPINS = 3
const WHEEL_INNER = 3.2
const WHEEL_OUTER = 5.4
/** 指针在正上方 */
const POINTER_ANGLE = -Math.PI / 2
/** 五等分扇区 —— 视觉上各档一样大，"转动时概率相等"说的就是这一步 */
const SECTOR = (Math.PI * 2) / TIERS.length

/** 网格里的一格：颜色名，或 `null` 表示空白（不在圆环上）。 */
export type WheelCell = string | null

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

/**
 * 终帧的旋转量：让抽中那一档的扇区中心正好停在指针下。
 * 结果先定、角度再反推，所以转盘停在哪一格永远是真实结果 —— 动画只负责演。
 */
export function finalRotation(tierIndex: number): number {
  const target = tierIndex * SECTOR + SECTOR / 2 - POINTER_ANGLE
  const wrapped = ((target % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  return WHEEL_SPINS * Math.PI * 2 + wrapped
}

/** 某一帧的转盘。同样的输入一定给同样的画面 —— 没有随机数参与。 */
export function wheelGrid(tier: TierId, frame: number): WheelCell[][] {
  const target = Math.max(0, TIERS.findIndex((t) => t.id === tier))
  const progress = WHEEL_FRAMES > 1 ? Math.min(1, frame / (WHEEL_FRAMES - 1)) : 1
  const rotation = finalRotation(target) * easeOutCubic(progress)
  const half = (WHEEL_SIZE - 1) / 2

  const grid: WheelCell[][] = []
  for (let y = 0; y < WHEEL_SIZE; y++) {
    const row: WheelCell[] = []
    for (let x = 0; x < WHEEL_SIZE; x++) {
      const radius = Math.hypot(x - half, y - half)
      if (radius < WHEEL_INNER || radius > WHEEL_OUTER) {
        row.push(null)
        continue
      }
      const local = Math.atan2(y - half, x - half) + rotation
      const index = ((Math.floor(local / SECTOR) % TIERS.length) + TIERS.length) % TIERS.length
      row.push(TIERS[index]!.color)
    }
    grid.push(row)
  }
  return grid
}

/** 把一行压成游程（颜色 + 宽度）：一行最多几段，能省掉大量渲染元素。 */
export function encodeRow(cells: readonly WheelCell[]): { color: WheelCell; width: number }[] {
  const runs: { color: WheelCell; width: number }[] = []
  for (const cell of cells) {
    const last = runs[runs.length - 1]
    if (last && last.color === cell) last.width += 1
    else runs.push({ color: cell, width: 1 })
  }
  return runs
}
