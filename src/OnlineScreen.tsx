import { useEffect, useRef, useState } from 'preact/hooks'
import { BattleScreen } from './BattleScreen'
import { participants, type OnlineState } from './coop'

async function request(action: string, body: object | undefined, cancel: AbortSignal): Promise<OnlineState> {
  const signal = AbortSignal.any([cancel, AbortSignal.timeout(10_000)])
  const response = await fetch(`/api/${action}`, body === undefined
    ? { signal, cache: 'no-store' }
    : { signal, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('Сервер BrowAO недоступен.')
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? 'Запрос не выполнен.')
  return data
}

export function OnlineScreen() {
  const [state, setState] = useState<OnlineState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [disconnected, setDisconnected] = useState(false)
  const [message, setMessage] = useState('')
  const [now, setNow] = useState(Date.now)
  const serverOffset = useRef(0)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [leavingRoom, setLeavingRoom] = useState<string | null>(null)
  const polling = useRef<AbortController | null>(null)
  const posting = useRef<AbortController | null>(null)

  useEffect(() => {
    async function refresh() {
      if (posting.current || polling.current) return
      const controller = new AbortController()
      polling.current = controller
      try {
        const data = await request('state', undefined, controller.signal)
        if (!controller.signal.aborted) {
          serverOffset.current = data.serverTime - Date.now()
          setNow(Date.now())
          setState(data)
          setDisconnected(false)
        }
      } catch {
        if (!controller.signal.aborted) setDisconnected(true)
      } finally {
        if (polling.current === controller) polling.current = null
      }
    }
    void refresh()
    const timer = window.setInterval(() => {
      setNow(Date.now())
      void refresh()
    }, 1500)
    return () => {
      window.clearInterval(timer)
      posting.current?.abort()
      polling.current?.abort()
    }
  }, [])

  async function send(action: string, body: object = {}) {
    if (posting.current) return false
    polling.current?.abort()
    const controller = new AbortController()
    posting.current = controller
    setBusy(true)
    setError('')
    try {
      const data = await request(action, body, controller.signal)
      if (controller.signal.aborted) return false
      serverOffset.current = data.serverTime - Date.now()
      setNow(Date.now())
      setState(data)
      setDisconnected(false)
      return true
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Запрос не выполнен.')
      return false
    } finally {
      posting.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  const player = state?.player
  const room = state?.room
  const deadline = room ? Math.max(0, Math.ceil((room.deadline - now - serverOffset.current) / 1000)) : 0
  const active = room?.status === 'battle' || room?.status === 'invited'
  return <>
    <div class="world-heading"><h1>Венеция · общий зал</h1><p>Городской чат и экспедиция на двоих.</p></div>
    {disconnected && <p class="save-warning" role="alert">Связь с сервером потеряна. Повторяем подключение.</p>}
    {error && <p class="save-warning" role="alert">{error}</p>}
    {!state ? <p>Подключение к миру…</p> : !player ?
      <section class="world-panel">
        <h2>{mode === 'login' ? 'Войти в BrowAO' : 'Создать аккаунт'}</h2>
        <form class="online-form" key={mode} onSubmit={event => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          void send(mode, { name: data.get('name'), password: data.get('password') })
        }}>
          <label>Имя игрока<input name="name" autoComplete="username" required minLength={3} maxLength={24} /></label>
          <label>Пароль<input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required minLength={10} maxLength={256} /></label>
          <button class="primary" disabled={busy}>{mode === 'login' ? 'Войти' : 'Зарегистрироваться'}</button>
        </form>
        <button type="button" disabled={busy} onClick={() => { setError(''); setMode(mode === 'login' ? 'register' : 'login') }}>
          {mode === 'login' ? 'Создать аккаунт' : 'У меня есть аккаунт'}
        </button>
      </section> :
      <>
        <section class="world-panel">
          <div class="command-title"><h2>{player.name}</h2><button disabled={busy} onClick={async () => { if (await send('logout')) setMode('login') }}>Выйти</button></div>
          <p>Награды экспедиций · {player.coins} монет · {player.victories} побед</p>
        </section>
        {room?.status === 'invited' && <section class="world-panel">
          <h2>{room.slot === 'guest' ? 'Приглашение в экспедицию' : 'Ожидание напарника'}</h2>
          <p>{room.host} и {room.guest} · осталось {deadline} с</p>
          {room.slot === 'guest' && <button class="primary" disabled={busy} onClick={() => void send('accept', { room: room.id })}>Принять приглашение</button>}
          <button disabled={busy} onClick={() => void send('leave', { room: room.id })}>{room.slot === 'guest' ? 'Отклонить' : 'Отменить приглашение'}</button>
        </section>}
        {room?.status === 'battle' && room.battle && <section class="online-battle">
          <section class="world-panel">
            <h2>Группа · {room.host} и {room.guest}</h2>
            <p>Вы управляете: {room.slot === 'host' ? 'командир и стрелок' : 'защитник'}. Осталось {deadline} с.</p>
            <p aria-live="polite">{room.submitted ? 'Ваши приказы приняты.' : 'Отдайте приказы отряду.'} {room.partnerSubmitted ? 'Напарник готов.' : ''}</p>
            {leavingRoom !== room.id ? <button onClick={() => setLeavingRoom(room.id)}>Покинуть экспедицию</button> :
              <div class="travel"><button disabled={busy} onClick={() => { setLeavingRoom(null); void send('leave', { room: room.id }) }}>Завершить бой для группы</button>
                <button onClick={() => setLeavingRoom(null)}>Продолжить бой</button></div>}
          </section>
          <BattleScreen key={`${room.id}-${room.battle.round}`} shared={{
            battle: room.battle, ...participants[room.slot], locked: room.submitted || busy || deadline === 0,
            submit: orders => void send('orders', { room: room.id, round: room.battle!.round, orders }),
          }} />
        </section>}
        {room?.status === 'finished' && <section class="world-panel" aria-live="polite">
          <h2>{room.battle?.winner === 'party' ? 'Победа в экспедиции' : 'Экспедиция проиграна'}</h2>
          {room.battle?.winner === 'party' && <p>Каждый участник получил 10 монет.</p>}
        </section>}
        {room?.status === 'closed' && <section class="world-panel"><p>Группа распущена.</p></section>}
        {!active && <section class="world-panel">
          <h2>Игроки в сети</h2>
          {state.players.some(name => name !== player.name) ? <ul class="player-list">
            {state.players.filter(name => name !== player.name).map(name => <li key={name}>
              <strong>{name}</strong><button disabled={busy} onClick={() => void send('invite', { name })}>Пригласить {name}</button>
            </li>)}
          </ul> : <p>Пока вы один в зале.</p>}
        </section>}
        <section class="world-panel">
          <h2>Чат Венеции</h2>
          <ol class="online-chat">{state.messages.map(item => <li key={item.id}><strong>{item.name}</strong> · {item.text}</li>)}</ol>
          <form class="online-form" onSubmit={async event => {
            event.preventDefault()
            if (await send('chat', { text: message })) setMessage('')
          }}>
            <label>Сообщение<input required maxLength={300} value={message} onInput={event => setMessage(event.currentTarget.value)} /></label>
            <button disabled={busy || !message.trim()}>Отправить</button>
          </form>
        </section>
      </>}
  </>
}
