"use client"

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"

// Snake, the way the 3310 shipped it: wrap-around walls, 9 points a feed,
// speeds up as you eat. Steer with keypad 2/4/6/8.

const COLS = 26
const ROWS = 15
const CELL = 6
const START_SPEED_MS = 240
const MIN_SPEED_MS = 90

export type SnakeDir = "up" | "down" | "left" | "right"

export interface SnakeHandle {
  steer: (dir: SnakeDir) => void
  pressCenter: () => void // pause / resume / restart
}

interface Point {
  x: number
  y: number
}

const OPPOSITE: Record<SnakeDir, SnakeDir> = { up: "down", down: "up", left: "right", right: "left" }

function freshState() {
  const snake: Point[] = [
    { x: 8, y: 7 },
    { x: 7, y: 7 },
    { x: 6, y: 7 },
  ]
  return { snake, dir: "right" as SnakeDir, food: { x: 16, y: 7 }, score: 0, dead: false }
}

export const SnakeGame = forwardRef<SnakeHandle>(function SnakeGame(_, ref) {
  const stateRef = useRef(freshState())
  const dirQueueRef = useRef<SnakeDir[]>([])
  const pausedRef = useRef(false)
  const [, setFrame] = useState(0)
  const [paused, setPaused] = useState(false)

  useImperativeHandle(ref, () => ({
    steer: (dir: SnakeDir) => {
      const s = stateRef.current
      if (s.dead) return
      const lastQueued = dirQueueRef.current[dirQueueRef.current.length - 1] || s.dir
      if (dir !== lastQueued && dir !== OPPOSITE[lastQueued]) {
        dirQueueRef.current.push(dir)
      }
      if (pausedRef.current) {
        pausedRef.current = false
        setPaused(false)
      }
    },
    pressCenter: () => {
      const s = stateRef.current
      if (s.dead) {
        stateRef.current = freshState()
        dirQueueRef.current = []
        pausedRef.current = false
        setPaused(false)
        setFrame((f) => f + 1)
      } else {
        pausedRef.current = !pausedRef.current
        setPaused(pausedRef.current)
      }
    },
  }))

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>

    const placeFood = (snake: Point[]): Point => {
      while (true) {
        const p = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) }
        if (!snake.some((s) => s.x === p.x && s.y === p.y)) return p
      }
    }

    const tick = () => {
      const s = stateRef.current
      if (!s.dead && !pausedRef.current) {
        const queued = dirQueueRef.current.shift()
        if (queued) s.dir = queued

        const head = s.snake[0]
        const next: Point = {
          x: (head.x + (s.dir === "right" ? 1 : s.dir === "left" ? -1 : 0) + COLS) % COLS,
          y: (head.y + (s.dir === "down" ? 1 : s.dir === "up" ? -1 : 0) + ROWS) % ROWS,
        }

        const willEat = next.x === s.food.x && next.y === s.food.y
        const body = willEat ? s.snake : s.snake.slice(0, -1)
        if (body.some((p) => p.x === next.x && p.y === next.y)) {
          s.dead = true
        } else {
          s.snake = [next, ...body]
          if (willEat) {
            s.score += 9
            s.food = placeFood(s.snake)
          }
        }
        setFrame((f) => f + 1)
      }
      const speed = Math.max(MIN_SPEED_MS, START_SPEED_MS - Math.floor(stateRef.current.score / 9) * 12)
      timer = setTimeout(tick, speed)
    }

    timer = setTimeout(tick, START_SPEED_MS)
    return () => clearTimeout(timer)
  }, [])

  const { snake, food, score, dead } = stateRef.current

  return (
    <div className="flex-1 flex flex-col items-center">
      <div className="w-full flex justify-between text-[9px] font-bold px-1 mb-[2px]">
        <span>{score.toString().padStart(4, "0")}</span>
        <span>{dead ? "GAME OVER" : paused ? "PAUSED" : "SNAKE"}</span>
      </div>
      <svg
        width={COLS * CELL}
        height={ROWS * CELL}
        viewBox={`0 0 ${COLS * CELL} ${ROWS * CELL}`}
        shapeRendering="crispEdges"
        className="border border-current"
      >
        {snake.map((p, i) => (
          <rect key={i} x={p.x * CELL} y={p.y * CELL} width={CELL} height={CELL} fill="currentColor" />
        ))}
        <rect
          x={food.x * CELL + 1}
          y={food.y * CELL + 1}
          width={CELL - 2}
          height={CELL - 2}
          fill="currentColor"
          className="animate-pulse"
        />
      </svg>
      <div className="text-[8px] opacity-70 mt-[2px]">{dead ? "─ RESTART" : "2·4·6·8 STEER · ─ PAUSE"}</div>
    </div>
  )
})
