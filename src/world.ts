import points from './atlas-points.json'

export const places = points.places.map((point, index) => ({
  ...point,
  city: index === 0 || index === points.places.length - 1,
  scenario: index - 1,
}))

export const legs = [
  { mode: 'Морской путь', minutes: 40 },
  { mode: 'Морской путь', minutes: 55 },
  { mode: 'Прибрежный путь', minutes: 40 },
  { mode: 'Прибрежный путь', minutes: 20 },
]

export const contracts = [
  { name: 'Связь с дозором', detail: 'Доберитесь до Каорле, защитите дозор и вернитесь в Венецию.', city: 0, site: 1, coins: 12, supplies: 1 },
  { name: 'Караван у лагуны', detail: 'Сопроводите караван через Градо и доставьте отчёт в Венецию.', city: 0, site: 2, coins: 14, supplies: 1 },
  { name: 'Вести из Мирамаре', detail: 'Разберитесь с нападением в Мирамаре и доложите в Триесте.', city: 4, site: 3, coins: 16, supplies: 2 },
]

type ContractState = 'new' | 'active' | 'won' | 'claimed'
export interface Progress {
  location: number
  elapsed: number
  coins: number
  supplies: number
  contracts: ContractState[]
  recruit: boolean
  upgrade: boolean
}

const start: Progress = {
  location: 0, elapsed: 0, coins: 0, supplies: 0, contracts: ['new', 'new', 'new'], recruit: false, upgrade: false,
}
const storageKey = 'browao-world-v1'
const isCount = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export function loadProgress(): Progress {
  try {
    const data: Partial<Progress> | null = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if (data && isCount(data.location) && data.location! < places.length && isCount(data.elapsed)
      && isCount(data.coins) && isCount(data.supplies) && Array.isArray(data.contracts)
      && data.contracts.length === contracts.length
      && data.contracts.every(status => ['new', 'active', 'won', 'claimed'].includes(status))
      && typeof data.recruit === 'boolean' && typeof data.upgrade === 'boolean') {
      return data as Progress
    }
  } catch {
    // Play remains available when browser storage is blocked or damaged.
  }
  return start
}

export function saveProgress(progress: Progress) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(progress))
    return true
  } catch {
    return false
  }
}

export function travel(progress: Progress, destination: number): Progress {
  const leg = legs[Math.min(progress.location, destination)]
  if (Math.abs(progress.location - destination) !== 1 || !leg) return progress
  return { ...progress, location: destination, elapsed: progress.elapsed + leg.minutes }
}

export function updateContract(progress: Progress, index: number, event: 'accept' | 'win' | 'claim'): Progress {
  const contract = contracts[index]
  const status = progress.contracts[index]
  if (!contract) return progress
  const valid = event === 'accept' ? status === 'new' && progress.location === contract.city
    : event === 'win' ? status === 'active' && progress.location === contract.site
      : status === 'won' && progress.location === contract.city
  if (!valid) return progress
  const next = [...progress.contracts]
  next[index] = event === 'accept' ? 'active' : event === 'win' ? 'won' : 'claimed'
  return {
    ...progress, contracts: next,
    coins: progress.coins + (event === 'claim' ? contract.coins : 0),
    supplies: progress.supplies + (event === 'claim' ? contract.supplies : 0),
  }
}

export function train(progress: Progress, service: 'recruit' | 'upgrade'): Progress {
  if (!places[progress.location].city || progress[service]) return progress
  const price = service === 'recruit' ? 8 : 4
  const supplies = service === 'upgrade' ? 1 : 0
  if (progress.coins < price || progress.supplies < supplies) return progress
  return { ...progress, [service]: true, coins: progress.coins - price, supplies: progress.supplies - supplies }
}
