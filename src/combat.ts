export type Side = 'party' | 'enemy'
export type Action = 'strike' | 'cover' | 'shot' | 'move'
type Role = 'leader' | 'guard' | 'archer'

export interface Unit {
  id: string
  name: string
  role: Role
  side: Side
  cell: number
  hp: number
  maxHp: number
  shotReady: number
  covered: boolean
}

export interface Order {
  actor: string
  action: Action
  target: string | number
}

export interface Battle {
  round: number
  units: Unit[]
  log: string[]
  winner: Side | null
}

export const actions = {
  strike: { name: 'Удар', cost: 1, detail: '3 урона по ближнему доступному ряду.' },
  cover: { name: 'Прикрытие', cost: 1, detail: 'Следующий удар по союзнику в этом ряду слабее на 2.' },
  shot: { name: 'Прицельный выстрел', cost: 2, detail: '4 урона по любому ряду. Пропуск одного хода между выстрелами.' },
  move: { name: 'Смена позиции', cost: 1, detail: 'Перейти на свободную клетку своего строя.' },
} satisfies Record<Action, { name: string; cost: number; detail: string }>

const skills: Record<Role, Action[]> = {
  leader: ['strike', 'move'],
  guard: ['strike', 'cover', 'move'],
  archer: ['strike', 'shot', 'move'],
}

type Fighter = [name: string, role: Role, cell: number, hp: number]
const party: Fighter[] = [['Командир', 'leader', 0, 9], ['Защитник', 'guard', 1, 11], ['Стрелок', 'archer', 4, 7]]

export const scenarios: { name: string; detail: string; enemies: Fighter[] }[] = [
  { name: 'Засада у переправы', detail: 'Отбейте налёт на караван.', enemies: [['Налётчик', 'leader', 1, 7], ['Дозорный', 'guard', 3, 6]] },
  { name: 'Дозор на перевале', detail: 'Переживите обстрел из заднего ряда.', enemies: [['Страж', 'guard', 0, 10], ['Арбалетчик', 'archer', 4, 8]] },
  { name: 'Ворота заставы', detail: 'Прорвите оборону из трёх бойцов.', enemies: [['Начальник', 'leader', 1, 9], ['Щитоносец', 'guard', 2, 10], ['Меткий стрелок', 'archer', 4, 8]] },
]

const row = (cell: number) => Math.floor(cell / 3)
const living = (battle: Battle, side: Side) => battle.units.filter(unit => unit.side === side && unit.hp > 0)

export function startBattle(scenario: number): Battle {
  const setup = (fighters: Fighter[], side: Side): Unit[] => fighters.map(([name, role, cell, hp], index) => ({
    id: side + index, name, role, side, cell, hp, maxHp: hp, shotReady: 1, covered: false,
  }))
  return {
    round: 1,
    units: [...setup(party, 'party'), ...setup(scenarios[scenario].enemies, 'enemy')],
    log: ['Отряды заняли позиции.'],
    winner: null,
  }
}

export function available(unit: Unit, round: number) {
  return skills[unit.role].filter(action => action !== 'shot' || unit.shotReady <= round)
}

export function targets(battle: Battle, actor: Unit, action: Action): (string | number)[] {
  if (!actor.hp || !available(actor, battle.round).includes(action)) return []
  const allies = living(battle, actor.side)
  if (action === 'move') return [0, 1, 2, 3, 4, 5].filter(cell => allies.every(unit => unit.cell !== cell))
  if (action === 'cover') return allies.filter(unit => unit.id !== actor.id && row(unit.cell) === row(actor.cell)).map(unit => unit.id)
  const opponents = living(battle, actor.side === 'party' ? 'enemy' : 'party')
  const front = opponents.filter(unit => row(unit.cell) === 0)
  return (action === 'strike' && front.length ? front : opponents).map(unit => unit.id)
}

function apply(battle: Battle, order: Order) {
  const actor = battle.units.find(unit => unit.id === order.actor)
  if (!actor || !targets(battle, actor, order.action).includes(order.target)) {
    battle.log.push(`${actor?.name ?? 'Боец'} пропускает действие. Цель недоступна.`)
    return
  }
  if (order.action === 'move' && typeof order.target === 'number') {
    actor.cell = order.target
    battle.log.push(`${actor.name} меняет позицию.`)
    return
  }
  const target = battle.units.find(unit => unit.id === order.target)!
  if (order.action === 'cover') {
    target.covered = true
    battle.log.push(`${actor.name} прикрывает союзника «${target.name}».`)
    return
  }
  const damage = (order.action === 'shot' ? 4 : 3) - (target.covered ? 2 : 0)
  target.covered = false
  target.hp = Math.max(0, target.hp - damage)
  if (order.action === 'shot') actor.shotReady = battle.round + 2
  battle.log.push(`${actor.name} → ${target.name}. Урон: ${damage}.${target.hp ? '' : ' Цель выбыла.'}`)
}

export function orderCost(orders: Order[]) {
  return orders.reduce((sum, order) => sum + actions[order.action].cost, 0)
}

export function preview(battle: Battle, orders: Order[]): Battle {
  const next = { ...battle, units: battle.units.map(unit => ({ ...unit })), log: [...battle.log] }
  const used = new Set<string>()
  let spent = 0
  for (const order of orders) {
    if (used.has(order.actor) || !living(next, 'party').some(unit => unit.id === order.actor)) continue
    spent += actions[order.action].cost
    if (spent > 3) break
    used.add(order.actor)
    apply(next, order)
  }
  return next
}

export function enemyOrders(battle: Battle): Order[] {
  const orders: Order[] = []
  const enemies = living(battle, 'enemy')
  // Ready archers get first claim on the shared budget.
  enemies.sort((a, b) => Number(available(b, battle.round).includes('shot')) - Number(available(a, battle.round).includes('shot')))
  for (const actor of enemies) {
    const remaining = 3 - orderCost(orders)
    if (!remaining) break
    const action = available(actor, battle.round).includes('shot') && remaining >= 2 ? 'shot' : 'strike'
    const candidates = targets(battle, actor, action)
    const target = action === 'shot'
      ? living(battle, 'party').filter(unit => candidates.includes(unit.id)).sort((a, b) => b.cell - a.cell)[0]?.id
      : candidates[0]
    if (target !== undefined) orders.push({ actor: actor.id, action, target })
  }
  return orders
}

export function finishTurn(battle: Battle, orders: Order[]): Battle {
  if (battle.winner) return battle
  const next = preview(battle, orders)
  next.log.splice(battle.log.length, 0, `Раунд ${battle.round}`)
  if (!living(next, 'enemy').length) {
    next.winner = 'party'
    return next
  }
  for (const order of enemyOrders(battle)) apply(next, order)
  if (!living(next, 'party').length) {
    next.winner = 'enemy'
    return next
  }
  next.round += 1
  for (const unit of living(next, 'party')) unit.covered = false
  return next
}
