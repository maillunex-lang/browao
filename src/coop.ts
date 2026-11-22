import { actions, finishTurn, orderCost, preview, targets, type Action, type Battle, type Order } from './combat.ts'

export type Slot = 'host' | 'guest'
export const participants = {
  host: { units: ['party0', 'party2'], budget: 2 },
  guest: { units: ['party1'], budget: 1 },
}

export interface Room {
  id: string
  host: string
  guest: string
  slot: Slot
  status: 'invited' | 'battle' | 'finished' | 'closed'
  battle: Battle | null
  deadline: number
  submitted: boolean
  partnerSubmitted: boolean
}

export interface OnlineState {
  serverTime: number
  player: { name: string; coins: number; victories: number } | null
  players: string[]
  messages: { id: number; name: string; text: string }[]
  room: Room | null
}

export function validateOrders(battle: Battle, slot: Slot, proposed: unknown): Order[] | null {
  if (!Array.isArray(proposed) || proposed.length > participants[slot].units.length) return null
  const { units, budget } = participants[slot]
  const orders: Order[] = []
  for (const item of proposed) {
    if (!item || typeof item.actor !== 'string' || !units.includes(item.actor)
      || typeof item.action !== 'string' || !Object.hasOwn(actions, item.action)
      || orders.some(order => order.actor === item.actor)) return null
    const state = preview(battle, orders)
    const actor = state.units.find(unit => unit.id === item.actor)
    const action = item.action as Action
    if (!actor || !targets(state, actor, action).includes(item.target)) return null
    orders.push({ actor: actor.id, action, target: item.target })
  }
  return orderCost(orders) <= budget ? orders : null
}

export function resolveRound(battle: Battle, host: Order[], guest: Order[]) {
  const next = finishTurn(battle, [...host, ...guest])
  if (!next.winner && next.round > 20) {
    next.winner = 'enemy'
    next.log.push('Время экспедиции истекло.')
  }
  return { ...next, log: next.log.slice(-32) }
}
