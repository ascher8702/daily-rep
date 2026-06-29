import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { KeyboardEvent } from 'react'
import type { WorkoutExercise } from '../types'
import { radioKeyDown } from '../lib/a11y'
import { supersetLabel, exerciseGroupLabel } from '../lib/supersets'

// Extra coverage for the pure a11y-facing helpers. radioKeyDown drives keyboard nav for a
// role="radiogroup"; the superset label helpers produce the "A1"/"Superset" text announced on the
// session screen. Same hand-mocked DOM surface as a11y.test.ts (no jsdom).

// ---- radioKeyDown: branches not exercised by a11y.test.ts (ArrowLeft, out-of-group focus) ----

type Radio = { i: number; clicked: boolean; focus: () => void; click: () => void }

let active: Radio | null = null

function group(n: number, checkedIdx: number) {
  const radios: Radio[] = Array.from({ length: n }, (_, i) => {
    const el: Radio = {
      i,
      clicked: false,
      focus() {
        active = el
      },
      click() {
        el.clicked = true
      },
    }
    return el
  })
  active = radios[checkedIdx]
  const currentTarget = { querySelectorAll: () => radios } as unknown as HTMLDivElement
  return { radios, currentTarget }
}

function press(key: string, currentTarget: HTMLDivElement): KeyboardEvent<HTMLDivElement> {
  return { key, currentTarget, preventDefault() {} } as unknown as KeyboardEvent<HTMLDivElement>
}

beforeEach(() => {
  ;(globalThis as { document?: unknown }).document = {
    get activeElement() {
      return active
    },
  }
})
afterEach(() => {
  delete (globalThis as { document?: unknown }).document
  active = null
})

describe('radioKeyDown — additional keyboard branches', () => {
  it('ArrowLeft moves focus and selection to the previous radio', () => {
    const { radios, currentTarget } = group(3, 2)
    radioKeyDown(press('ArrowLeft', currentTarget))
    expect(active).toBe(radios[1])
    expect(radios[1].clicked).toBe(true)
  })

  it('ArrowLeft from the first radio wraps to the last', () => {
    const { radios, currentTarget } = group(3, 0)
    radioKeyDown(press('ArrowLeft', currentTarget))
    expect(active).toBe(radios[2])
    expect(radios[2].clicked).toBe(true)
  })

  it('when focus is outside the group, ArrowDown advances from index 0 (idx === -1 fallback)', () => {
    // With nothing in the group focused, indexOf returns -1; the helper treats that as index 0 and
    // then applies the direction, so ArrowDown lands on the second radio.
    const { radios, currentTarget } = group(3, 0)
    active = null
    radioKeyDown(press('ArrowDown', currentTarget))
    expect(active).toBe(radios[1])
    expect(radios[1].clicked).toBe(true)
  })

  it('when focus is outside the group, ArrowUp wraps to the last radio (idx === -1 fallback)', () => {
    const { radios, currentTarget } = group(3, 0)
    active = null
    radioKeyDown(press('ArrowUp', currentTarget))
    expect(active).toBe(radios[2])
    expect(radios[2].clicked).toBe(true)
  })

  it('a single-radio group keeps focus/selection on that radio under any arrow key', () => {
    const { radios, currentTarget } = group(1, 0)
    radioKeyDown(press('ArrowDown', currentTarget))
    expect(active).toBe(radios[0])
    radioKeyDown(press('ArrowUp', currentTarget))
    expect(active).toBe(radios[0])
    expect(radios[0].clicked).toBe(true)
  })
})

// ---- superset accessible labels (no DOM needed) ----

describe('supersetLabel — accessible group name by size', () => {
  it('names 2/3/4+ as Superset/Tri-set/Circuit', () => {
    expect(supersetLabel(2)).toBe('Superset')
    expect(supersetLabel(3)).toBe('Tri-set')
    expect(supersetLabel(4)).toBe('Circuit')
    expect(supersetLabel(6)).toBe('Circuit')
  })

  it('returns an empty string for fewer than 2 (no group to announce)', () => {
    expect(supersetLabel(1)).toBe('')
    expect(supersetLabel(0)).toBe('')
  })
})

describe('exerciseGroupLabel — A1/B2 position labels', () => {
  const we = (id: string, group?: string): WorkoutExercise =>
    ({ exerciseId: id, group, sets: [] }) as unknown as WorkoutExercise

  it('labels consecutive same-group lifts A1, A2 and leaves straight sets unlabelled', () => {
    const list = [we('a', 'g1'), we('b', 'g1'), we('c')]
    expect(exerciseGroupLabel(list, 0)).toBe('A1')
    expect(exerciseGroupLabel(list, 1)).toBe('A2')
    expect(exerciseGroupLabel(list, 2)).toBeNull()
  })

  it('does not label a group that collapsed to a single member', () => {
    const list = [we('a', 'g1'), we('b')]
    expect(exerciseGroupLabel(list, 0)).toBeNull()
  })

  it('advances the letter across separate groups (A then B)', () => {
    const list = [we('a', 'g1'), we('b', 'g1'), we('c', 'g2'), we('d', 'g2')]
    expect(exerciseGroupLabel(list, 2)).toBe('B1')
    expect(exerciseGroupLabel(list, 3)).toBe('B2')
  })
})
