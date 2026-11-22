import { render } from 'preact'
import { useRef, useState } from 'preact/hooks'
import points from './atlas-points.json'
import atlas from './atlas-geometry.json'
import { BattleScreen } from './BattleScreen'
import { OnlineScreen } from './OnlineScreen'
import { contracts, legs, loadProgress, places, saveProgress, train, travel, updateContract, type Progress } from './world'
import './style.css'

const demo = import.meta.env.MODE === 'demo'

type Page = 'atlas' | 'route' | 'squad' | 'journal' | 'training' | 'online'
const statuses = { new: 'Доступен', active: 'Принят', won: 'Готов к сдаче', claimed: 'Завершён' }

function Atlas({ onRoute }: { onRoute: () => void }) {
  const [selected, select] = useState('eu')
  const { width, height, land, markers } = atlas.world
  const continent = points.continents.find(item => item.id === selected)!
  return <>
    <div class="world-heading"><h1>Атлас Земли</h1><p>Выберите континент, чтобы посмотреть доступные маршруты.</p></div>
    <div class="map world-map" style={{ aspectRatio: `${width} / ${height}` }}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Карта реальной Земли">
        <path d={land} />
      </svg>
      {points.continents.map(({ id, name }, index) => {
        const [x, y] = markers[id as keyof typeof markers]
        return <button key={id} class="map-marker" style={{ left: `${x / width * 100}%`, top: `${y / height * 100}%` }}
          aria-label={name} aria-pressed={selected === id} onClick={() => select(id)}>
          <span aria-hidden="true">{index + 1}</span>
        </button>
      })}
    </div>
    <div class="continent-list" aria-label="Континенты">
      {points.continents.map(({ id, name }, index) => <button key={id} aria-pressed={selected === id}
        onClick={() => select(id)}>{index + 1}. {name}</button>)}
    </div>
    <section class="world-panel">
      <h2>{continent.name}</h2>
      {selected === 'eu' ? <><p>Северная Адриатика · маршрут между Венецией и Триестом.</p>
        <button class="primary" onClick={onRoute}>Открыть Адриатику</button></>
        : <p>Экспедиционные маршруты пока закрыты.</p>}
    </section>
  </>
}

function RegionMap({ location }: { location: number }) {
  const { width, height, land, markers } = atlas.region
  const coords = places.map(({ id }) => markers[id as keyof typeof markers])
  return <div class="map regional-map">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Карта северной Адриатики с пятью точками маршрута">
      <path d={land} />
      <polyline points={coords.map(point => point.join(',')).join(' ')} />
      {coords.map(([x, y], index) => <g key={places[index].id} class={index === location ? 'current-marker' : ''}>
        <circle cx={x} cy={y} r={13} />
        <text x={x} y={y}>{index + 1}</text>
      </g>)}
    </svg>
  </div>
}

function App() {
  const [page, setPage] = useState<Page>(() => !demo && location.hash === '#online' ? 'online' : 'atlas')
  const [progress, setProgress] = useState(loadProgress)
  const latestProgress = useRef(progress)
  const [storageError, setStorageError] = useState(false)
  const [fight, setFight] = useState<number | null>(null)
  const place = places[progress.location]
  const activeHere = contracts.findIndex((contract, index) => contract.site === progress.location && progress.contracts[index] === 'active')

  function open(next: Page) {
    setPage(next)
    if (next === 'online' || location.hash === '#online') history.replaceState(null, '', next === 'online' ? '#online' : location.pathname + location.search)
    window.scrollTo(0, 0)
  }

  function change(update: (value: Progress) => Progress) {
    const next = update(latestProgress.current)
    if (next === latestProgress.current) return
    latestProgress.current = next
    setStorageError(!saveProgress(next))
    setProgress(next)
  }

  function returnFromBattle(won: boolean) {
    if (fight !== null && won) change(value => updateContract(value, fight, 'win'))
    setFight(null)
    open('route')
  }

  return <main>
    <header class="masthead"><a href="./">BrowAO</a><span>{demo ? 'Демо · Северная Адриатика' : 'Северная Адриатика'}</span></header>
    {fight === null && <nav class="world-nav" aria-label="Основная навигация">
      {([['atlas', 'Атлас'], ['route', 'Маршрут'], ['journal', 'Контракты'], ['squad', 'Отряд'], ['training', 'Учения'], ['online', 'Онлайн']] as const)
        .filter(([id]) => !demo || id !== 'online')
        .map(([id, name]) => <button key={id} aria-current={id === page ? 'page' : undefined} onClick={() => open(id)}>{name}</button>)}
    </nav>}
    {storageError && <p class="save-warning" role="alert">Браузер не сохраняет прогресс. Он доступен до закрытия страницы.</p>}
    {fight !== null ? <BattleScreen key={fight} expedition={{
      scenario: place.scenario, name: place.name, recruit: progress.recruit, upgrade: progress.upgrade,
    }} onReturn={returnFromBattle} />
    : <>
      {page === 'atlas' && <Atlas onRoute={() => open('route')} />}
      {page === 'training' && <BattleScreen />}
      {page === 'online' && <OnlineScreen />}
      {page === 'route' && <>
        <div class="world-heading"><h1>Северная Адриатика</h1><p>В пути по игровому времени · {progress.elapsed} мин</p></div>
        <RegionMap location={progress.location} />
        <ol class="route-list" aria-label="Точки маршрута">
          {places.map((item, index) => <li key={item.id} aria-current={index === progress.location ? 'location' : undefined}>
            {item.name} <small>{item.city ? 'Город' : 'Экспедиция'}</small>
          </li>)}
        </ol>
        <section class="world-panel">
          <h2>Ваше местоположение · {place.name}</h2>
          {place.city ? <p>Здесь можно взять или сдать контракт, нанять бойца и улучшить отряд.</p>
            : <p>{activeHere >= 0 ? 'Задание принято. Отряд готов к бою.' : 'Бой доступен по активному контракту.'}</p>}
          {activeHere >= 0 && <button class="primary" onClick={() => { setFight(activeHere); window.scrollTo(0, 0) }}>Вступить в бой</button>}
          {place.city && <button class="primary" onClick={() => open('journal')}>Доска контрактов</button>}
          <div class="travel">
            {[progress.location - 1, progress.location + 1].filter(index => places[index]).map(index => {
              const leg = legs[Math.min(progress.location, index)]
              return <button key={index} onClick={() => change(value => travel(value, index))}>
                <strong>В путь · {places[index].name}</strong><small>{leg.mode} · {leg.minutes} мин</small>
              </button>
            })}
          </div>
        </section>
      </>}
      {page === 'journal' && <>
        <div class="world-heading"><h1>Контракты</h1><p>Текущее местоположение · {place.name}</p></div>
        {contracts.map((contract, index) => {
          const status = progress.contracts[index]
          const isHere = progress.location === contract.city
          return <section class="world-panel" key={contract.name}>
            <div class="command-title"><h2>{contract.name}</h2><span>{statuses[status]}</span></div>
            <p>{contract.detail}</p>
            <p>Оплата · {contract.coins} монет, {contract.supplies} ед. припасов</p>
            {isHere && status === 'new' && <button class="primary" onClick={() => change(value => updateContract(value, index, 'accept'))}>Принять контракт</button>}
            {isHere && status === 'won' && <button class="primary" onClick={() => change(value => updateContract(value, index, 'claim'))}>Сдать контракт</button>}
            {status === 'active' && <button onClick={() => open('route')}>К маршруту</button>}
          </section>
        })}
      </>}
      {page === 'squad' && <>
        <div class="world-heading"><h1>Ваш отряд</h1><p>Монеты · {progress.coins}　Припасы · {progress.supplies}</p></div>
        <section class="world-panel">
          <h2>Командир · {progress.upgrade ? 12 : 9} ОЗ</h2>
          <p>Улучшение доспеха добавляет 3 ОЗ. Цена · 4 монеты и 1 ед. припасов.</p>
          {progress.upgrade ? <p>Доспех улучшен.</p>
            : <button class="primary" disabled={!place.city || progress.coins < 4 || progress.supplies < 1}
              onClick={() => change(value => train(value, 'upgrade'))}>Улучшить доспех</button>}
        </section>
        <section class="world-panel"><h2>Защитник · 11 ОЗ</h2><p>Прикрывает союзника в своём ряду.</p></section>
        <section class="world-panel">
          <h2>{progress.recruit ? 'Лучник-наёмник · 10 ОЗ' : 'Стрелок · 7 ОЗ'}</h2>
          <p>В городе можно нанять лучника взамен стартового стрелка. Цена · 8 монет.</p>
          {progress.recruit ? <p>Лучник нанят.</p>
            : <button class="primary" disabled={!place.city || progress.coins < 8}
              onClick={() => change(value => train(value, 'recruit'))}>Нанять лучника</button>}
        </section>
      </>}
    </>}
  </main>
}

render(<App />, document.getElementById('app')!)
