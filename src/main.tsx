import { render } from 'preact'
import { useState } from 'preact/hooks'
import {
  actions, available, enemyOrders, finishTurn, orderCost, preview, scenarios, startBattle, targets,
  type Action, type Order, type Side,
} from './combat'
import './style.css'

const cellName = (cell: number) => `${cell < 3 ? 'Передний' : 'Задний'} ряд · ${cell % 3 + 1}`

function App() {
  const [scenario, setScenario] = useState(0)
  const [unlocked, setUnlocked] = useState(0)
  const [battle, setBattle] = useState(() => startBattle(0))
  const [orders, setOrders] = useState<Order[]>([])
  const [actorId, setActorId] = useState<string | null>(null)
  const [action, setAction] = useState<Action | null>(null)
  const projected = preview(battle, orders)
  const actor = projected.units.find(unit => unit.id === actorId && unit.hp > 0)
  const validTargets = actor && action ? targets(projected, actor, action) : []
  const remaining = 3 - orderCost(orders)
  const unitName = (id: string) => battle.units.find(unit => unit.id === id)?.name ?? id

  function resetSelection() {
    setActorId(null)
    setAction(null)
  }

  function openScenario(index: number) {
    setScenario(index)
    setBattle(startBattle(index))
    setOrders([])
    resetSelection()
  }

  function chooseTarget(target: string | number) {
    if (!actor || !action || !validTargets.includes(target)) return
    setOrders([...orders, { actor: actor.id, action, target }])
    resetSelection()
  }

  function commitTurn() {
    const next = finishTurn(battle, orders)
    if (next.winner === 'party') setUnlocked(Math.max(unlocked, Math.min(scenarios.length - 1, scenario + 1)))
    setBattle(next)
    setOrders([])
    resetSelection()
  }

  function formation(side: Side) {
    return <section class="formation">
      <h2>{side === 'party' ? 'Ваш строй' : 'Противник'}</h2>
      {[0, 1].map(row => <div class="formation-row" key={row}>
        <div class="row-label">{row === 0 ? 'Передний ряд' : 'Задний ряд'}</div>
        <div class="cells">
          {[0, 1, 2].map(column => {
            const cell = row * 3 + column
            const unit = projected.units.find(item => item.side === side && item.cell === cell && item.hp > 0)
            const value = unit?.id ?? cell
            const isTarget = !battle.winner && (unit || side === 'party') && validTargets.includes(value)
            const canSelect = !battle.winner && !action && side === 'party' && unit && !orders.some(order => order.actor === unit.id)
            return <button type="button" key={cell} class={`cell ${side} ${isTarget ? 'target' : ''} ${actorId && actorId === unit?.id ? 'selected' : ''}`}
              disabled={!isTarget && !canSelect}
              aria-label={unit ? `${unit.name}, ${unit.hp} из ${unit.maxHp}, ${cellName(cell)}` : `Свободная клетка. ${cellName(cell)}`}
              onClick={() => isTarget ? chooseTarget(value) : setActorId(unit?.id ?? null)}>
              {unit ? <>
                <strong>{unit.name}</strong>
                <small>{unit.hp}/{unit.maxHp} ОЗ{unit.covered ? ' · щит' : ''}</small>
              </> : <span class="empty">—</span>}
            </button>
          })}
        </div>
      </div>)}
    </section>
  }

  return <main>
    <header class="masthead">
      <a href="./">BrowAO</a><span>Полевые учения</span>
    </header>
    <nav aria-label="Учебные бои" class="scenarios">
      {scenarios.map((item, index) => <button key={item.name} disabled={index > unlocked}
        aria-current={index === scenario ? 'step' : undefined} onClick={() => openScenario(index)}>
        {item.name}
      </button>)}
    </nav>
    <div class="heading">
      <div><h1>{scenarios[scenario].name}</h1><p>{scenarios[scenario].detail}</p></div>
      <span class="round">Раунд {battle.round}</span>
    </div>
    <div class="board">
      {formation('enemy')}
      {formation('party')}
    </div>
    {!battle.winner && <section class="intent">
      <h2>Намерение противника</h2>
      <ul>{enemyOrders(battle).map(order => <li key={order.actor}>
        {unitName(order.actor)} · {actions[order.action].name} → {unitName(String(order.target))}
      </li>)}</ul>
    </section>}
    <section class="command">
      {battle.winner ? <>
        <h2 aria-live="polite">{battle.winner === 'party' ? 'Победа' : 'Поражение'}</h2>
        <div class="controls">
          <button onClick={() => openScenario(scenario)}>Повторить бой</button>
          {battle.winner === 'party' && scenario + 1 < scenarios.length &&
            <button class="primary" onClick={() => openScenario(scenario + 1)}>Следующий бой</button>}
        </div>
      </> : <>
        <div class="command-title"><h2>Приказы</h2><span>{remaining} / 3 очка</span></div>
        <p aria-live="polite">{action ? 'Выберите подсвеченную цель в строю.' : actor ? `Приказы бойца «${actor.name}»` : 'Выберите бойца в своём строю.'}</p>
        {actor && !action && <div class="cards">
          {available(actor, battle.round).map(key => <button key={key}
            disabled={actions[key].cost > remaining || !targets(projected, actor, key).length}
            onClick={() => setAction(key)}>
            <strong>{actions[key].name} · {actions[key].cost}</strong>
            <small>{actions[key].detail}</small>
          </button>)}
        </div>}
        {orders.length > 0 && <ol class="queue" aria-label="План хода">
          {orders.map(order => <li key={order.actor}>{unitName(order.actor)} · {actions[order.action].name} → {
            typeof order.target === 'number' ? cellName(order.target) : unitName(order.target)
          }</li>)}
        </ol>}
        <div class="controls">
          {actor && <button onClick={resetSelection}>Отменить выбор</button>}
          {orders.length > 0 && <button onClick={() => { setOrders(orders.slice(0, -1)); resetSelection() }}>Убрать последний</button>}
          <button class="primary" onClick={commitTurn}>{orders.length ? 'Подтвердить ход' : 'Пропустить ход'}</button>
        </div>
      </>}
    </section>
    <section class="journal">
      <h2>Журнал боя</h2>
      <ol aria-label="Последние события">{battle.log.slice(-18).reverse().map((entry, index) =>
        <li key={index}>{entry}</li>)}</ol>
    </section>
  </main>
}

render(<App />, document.getElementById('app')!)
