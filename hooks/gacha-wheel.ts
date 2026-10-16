/**
 * 像素转盘：把"六个色块 + 某一帧"算成一张档位网格。纯函数，无 `$`，可直接单测。
 *
 * 为什么要单独一个文件：这个功能最容易错的地方是**终帧指针到底停在哪一块**。
 * 抽奖结果先定、旋转角度由结果反推，所以"指针下那一块 === 中奖那一块"是一条
 * 必须成立的不变量 —— 放在这里，测试里可以直接断言。
 *
 * 六个等角扇区，每块的颜色来自该次抽奖按概率生成的结果（见 gacha-items 的
 * `rollDraw`），所以盘面大概率一片蓝 —— 这是诚实的，不是摆设。
 */

import type { TierId } from '../types'
import { WHEEL_SLOTS } from './gacha-items'

export const WHEEL_SIZE = 11
export const WHEEL_FRAMES = 22
export const WHEEL_TICK_MS = 100
const WHEEL_SPINS = 3
const WHEEL_INNER = 3.2
const WHEEL_OUTER = 5.4
/** 指针在正上方 */
const POINTER_ANGLE = -Math.PI / 2
/** 六等分扇区，每块一个色块 */
const SECTOR = (Math.PI * 2) / WHEEL_SLOTS

/** 网格里的一格：档位，或 `null` 表示空白（不在圆环上）。 */
export type WheelCell = TierId | null

function slotAt(rotation: number, angle: number): number {
  const local = angle + rotation
  return ((Math.floor(local / SECTOR) % WHEEL_SLOTS) + WHEEL_SLOTS) % WHEEL_SLOTS
}

/** 当前旋转量下，指针（正上方）压着第几块。 */
export function slotAtPointer(rotation: number): number {
  return slotAt(rotation, POINTER_ANGLE)
}

/**
 * 终帧的旋转量：让第 `slot` 块的中心正好停在指针下。
 * 结果先定、角度再反推，所以转盘停在哪一块永远是真实结果 —— 动画只负责演。
 */
export function finalRotation(slot: number): number {
  const target = slot * SECTOR + SECTOR / 2 - POINTER_ANGLE
  const wrapped = ((target % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  return WHEEL_SPINS * Math.PI * 2 + wrapped
}

/**
 * 某一帧的转盘。`slots` 是这次抽奖生成的六个色块，`target` 是最终要停的那一块。
 * 同样的输入一定给同样的画面 —— 没有随机数参与。
 */
export function wheelGrid(
  slots: readonly TierId[],
  target: number,
  frame: number,
): WheelCell[][] {
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
      row.push(slots[slotAt(rotation, Math.atan2(y - half, x - half))] ?? null)
    }
    grid.push(row)
  }
  return grid
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

/** 把一行压成游程（档位 + 宽度）：一行最多几段，能省掉大量渲染元素。 */
export function encodeRow(cells: readonly WheelCell[]): { tier: WheelCell; width: number }[] {
  const runs: { tier: WheelCell; width: number }[] = []
  for (const cell of cells) {
    const last = runs[runs.length - 1]
    if (last && last.tier === cell) last.width += 1
    else runs.push({ tier: cell, width: 1 })
  }
  return runs
}
