import { createServer } from 'node:http'
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { createReadStream, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { resolveRound, validateOrders } from '../src/coop.ts'
import { startBattle } from '../src/combat.ts'
import { openStore } from './store.mjs'

const db = openStore(process.env.BROWAO_DB ?? 'data/world.sqlite')
const derive = promisify(scrypt)
const port = Number(process.env.PORT ?? 4174)
const base = resolve('dist')
const turnMs = 60_000
const invitationMs = 300_000
const sessionMs = 7 * 24 * 60 * 60 * 1000
const onlineMs = 20_000
const anonymous = { player: null, players: [], messages: [], room: null }
const loginAttempts = new Map()

class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function fail(status, message) {
  throw new ApiError(status, message)
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex')
}

function sessionCookie(token, maxAge) {
  const secure = process.env.BROWAO_SECURE_COOKIE === '1' ? '; Secure' : ''
  return `browao_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`
}

function authenticate(request, now) {
  const token = request.headers.cookie?.match(/(?:^|; *)browao_session=([a-f0-9]{64})(?:;|$)/)?.[1]
  if (!token) return null
  const key = tokenHash(token)
  const session = db.get('SELECT player_id, seen FROM sessions WHERE token = ? AND expires > ?', key, now)
  if (!session) return null
  if (now - session.seen >= 5000) db.run('UPDATE sessions SET seen = ? WHERE token = ?', now, key)
  return { id: session.player_id, key }
}

async function body(request) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') fail(415, 'Ожидается JSON.')
  const chunks = []
  let size = 0
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length
    if (size > 4096) {
      request.resume()
      fail(413, 'Запрос слишком большой.')
    }
    chunks.push(chunk)
  }
  let data
  try {
    data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    fail(400, 'Некорректный JSON.')
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'Некорректный запрос.')
  return data
}

function limitAuth(address, now) {
  for (const [key, value] of loginAttempts) {
    if (value.until <= now) loginAttempts.delete(key)
  }
  if (!loginAttempts.has(address) && loginAttempts.size >= 10000) fail(429, 'Повторите попытку позже.')
  const current = loginAttempts.get(address) ?? { count: 0, until: now + 60_000 }
  if (current.count >= 12) fail(429, 'Слишком много попыток. Подождите минуту.')
  current.count += 1
  loginAttempts.set(address, current)
}

async function signIn(request, response, data, register, now) {
  limitAuth(request.socket.remoteAddress ?? '', now)
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  if (!/^[a-zA-Z0-9_-]{3,24}$/.test(name) || typeof data.password !== 'string'
      || data.password.length < 10 || Buffer.byteLength(data.password) > 256) {
    fail(400, 'Имя: 3–24 латинские буквы, цифры, дефис или подчёркивание. Пароль: от 10 символов.')
  }
  const existing = db.get('SELECT id, password FROM players WHERE name = ?', name)
  const salt = register || !existing ? randomBytes(16).toString('hex') : existing.password.split(':')[0]
  const hash = await derive(data.password, salt, 64)
  let id
  if (register) {
    const row = db.get('INSERT INTO players(name,password) VALUES (?, ?) ON CONFLICT(name) DO NOTHING RETURNING id',
      name, `${salt}:${hash.toString('hex')}`)
    if (!row) fail(409, 'Это имя уже занято.')
    id = row.id
  } else {
    if (!existing || !timingSafeEqual(hash, Buffer.from(existing.password.split(':')[1], 'hex'))) {
      fail(401, 'Имя или пароль не подходят.')
    }
    id = existing.id
  }
  const token = randomBytes(32).toString('hex')
  db.transaction(() => {
    db.run('DELETE FROM sessions WHERE expires <= ?', now)
    db.run('INSERT INTO sessions VALUES (?, ?, ?, ?)', tokenHash(token), id, now + sessionMs, now)
  })
  response.setHeader('Set-Cookie', sessionCookie(token, sessionMs / 1000))
  return id
}

function currentRoom(id) {
  return db.get(`SELECT rooms.*, h.name AS host_name, g.name AS guest_name FROM rooms
    JOIN players h ON h.id = rooms.host JOIN players g ON g.id = rooms.guest
    WHERE rooms.host = ? OR rooms.guest = ? ORDER BY rooms.rowid DESC LIMIT 1`, id, id)
}

function settle(room, now) {
  const next = resolveRound(JSON.parse(room.battle),
    JSON.parse(room.host_orders ?? '[]'), JSON.parse(room.guest_orders ?? '[]'))
  const finished = next.winner !== null
  db.run('UPDATE rooms SET status = ?, deadline = ?, battle = ?, host_orders = NULL, guest_orders = NULL WHERE id = ?',
    finished ? 'finished' : 'battle', finished ? 0 : now + turnMs, JSON.stringify(next), room.id)
  if (next.winner === 'party') {
    db.run('UPDATE players SET coins = coins + 10, victories = victories + 1 WHERE id IN (?, ?)', room.host, room.guest)
  }
}

function expireRoom(room, now) {
  if (!room || room.deadline > now) return
  if (room.status === 'invited') db.run("UPDATE rooms SET status = 'closed', deadline = 0 WHERE id = ?", room.id)
  while (room?.status === 'battle' && room.deadline <= now) {
    settle(room, room.deadline)
    room = db.get('SELECT * FROM rooms WHERE id = ?', room.id)
  }
}

function state(id, now) {
  if (!id) return { ...anonymous, serverTime: now }
  let room = currentRoom(id)
  if (room && room.deadline <= now && (room.status === 'battle' || room.status === 'invited')) {
    db.transaction(() => expireRoom(currentRoom(id), now))
    room = currentRoom(id)
  }
  const slot = room?.host === id ? 'host' : 'guest'
  return {
    serverTime: now,
    player: db.get('SELECT name, coins, victories FROM players WHERE id = ?', id),
    players: db.all(`SELECT p.name FROM players p WHERE p.id IN
      (SELECT player_id FROM sessions WHERE seen > ? AND expires > ?) ORDER BY p.name LIMIT 60`, now - onlineMs, now).map(row => row.name),
    messages: db.all(`SELECT m.id, p.name, m.text FROM messages m
      JOIN players p ON p.id = m.player_id ORDER BY m.id DESC LIMIT 30`).reverse(),
    room: room ? {
      id: room.id, host: room.host_name, guest: room.guest_name, slot, status: room.status,
      deadline: room.deadline, battle: room.battle ? JSON.parse(room.battle) : null,
      submitted: (slot === 'host' ? room.host_orders : room.guest_orders) !== null,
      partnerSubmitted: (slot === 'host' ? room.guest_orders : room.host_orders) !== null,
    } : null,
  }
}

function mutate(id, action, data, now) {
  if (action === '/chat') {
    const text = typeof data.text === 'string' ? data.text.trim() : ''
    if (!text || text.length > 300) fail(400, 'Сообщение должно содержать от 1 до 300 символов.')
    const last = db.get('SELECT sent FROM messages WHERE player_id = ? ORDER BY id DESC LIMIT 1', id)
    if (last && now - last.sent < 1500) fail(429, 'Подождите перед следующим сообщением.')
    db.run('INSERT INTO messages(player_id,text,sent) VALUES (?, ?, ?)', id, text, now)
    db.run('DELETE FROM messages WHERE id <= (SELECT max(id) - 500 FROM messages)')
    return
  }
  let room = currentRoom(id)
  expireRoom(room, now)
  room = currentRoom(id)
  if (action === '/invite') {
    const target = typeof data.name === 'string' ? db.get('SELECT id FROM players WHERE name = ?', data.name) : null
    if (!target || target.id === id || !db.get('SELECT 1 FROM sessions WHERE player_id = ? AND seen > ? AND expires > ?',
      target.id, now - onlineMs, now)) fail(404, 'Игрок сейчас недоступен.')
    expireRoom(currentRoom(target.id), now)
    const partner = currentRoom(target.id)
    if ([room, partner].some(candidate => ['invited', 'battle'].includes(candidate?.status))) {
      fail(409, 'Один из игроков уже в группе.')
    }
    db.run("INSERT INTO rooms(id,host,guest,status,deadline) VALUES (?, ?, ?, 'invited', ?)",
      randomBytes(12).toString('hex'), id, target.id, now + invitationMs)
    return
  }
  if (!room || data.room !== room.id) fail(409, 'Группа больше недоступна.')
  if (action === '/accept' && room.status === 'invited' && room.guest === id) {
    db.run("UPDATE rooms SET status = 'battle', battle = ?, deadline = ? WHERE id = ?",
      JSON.stringify(startBattle(2)), now + turnMs, room.id)
    return
  }
  if (action === '/leave' && ['invited', 'battle'].includes(room.status)) {
    db.run("UPDATE rooms SET status = 'closed', deadline = 0, host_orders = NULL, guest_orders = NULL WHERE id = ?", room.id)
    return
  }
  if (action === '/orders' && room.battle) {
    const battle = JSON.parse(room.battle)
    // Request retries for an already resolved or submitted round are harmless.
    if (Number.isInteger(data.round) && (data.round < battle.round || room.status === 'finished')) return
    if (room.status !== 'battle' || data.round !== battle.round) fail(409, 'К этому раунду нельзя добавить приказы.')
    const slot = room.host === id ? 'host' : 'guest'
    const submitted = slot === 'host' ? room.host_orders : room.guest_orders
    if (submitted !== null) return
    const orders = validateOrders(battle, slot, data.orders)
    if (!orders) fail(400, 'Один или несколько приказов недоступны.')
    if (slot === 'host') db.run('UPDATE rooms SET host_orders = ? WHERE id = ?', JSON.stringify(orders), room.id)
    else db.run('UPDATE rooms SET guest_orders = ? WHERE id = ?', JSON.stringify(orders), room.id)
    const updated = currentRoom(id)
    if (updated.host_orders !== null && updated.guest_orders !== null) settle(updated, now)
    return
  }
  fail(409, 'Действие сейчас недоступно.')
}

function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(data))
}

const mutations = new Set(['/chat', '/invite', '/accept', '/leave', '/orders'])
const mime = { js: 'text/javascript', css: 'text/css', html: 'text/html' }
function serve(path, response) {
  const relativePath = path === '/' ? 'index.html' : path.slice(1)
  if (relativePath !== 'index.html' && !/^assets\/[\w-]+\.(js|css)$/.test(relativePath)) fail(404, 'Страница не найдена.')
  const file = resolve(base, relativePath)
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) fail(404, 'Сначала соберите клиент командой npm run build.')
  response.writeHead(200, {
    'Content-Type': `${mime[file.split('.').at(-1)]}; charset=utf-8`,
    'Cache-Control': relativePath === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  })
  const stream = createReadStream(file)
  stream.on('error', () => response.destroy())
  stream.pipe(response)
}

createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname
    if (!path.startsWith('/api/')) {
      if (request.method !== 'GET') fail(405, 'Метод недоступен.')
      serve(path, response)
      return
    }
    const action = path.slice(4)
    if (request.method === 'GET' && action === '/state') {
      const now = Date.now()
      json(response, 200, state(authenticate(request, now)?.id, now))
      return
    }
    if (request.method !== 'POST') fail(404, 'Действие не найдено.')
    if (request.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Действие доступно в игре.')
    const data = await body(request)
    const now = Date.now()
    if (action === '/login' || action === '/register') {
      const id = await signIn(request, response, data, action === '/register', now)
      json(response, 200, state(id, now))
      return
    }
    const session = authenticate(request, now)
    if (action === '/logout') {
      if (session) db.run('DELETE FROM sessions WHERE token = ?', session.key)
      response.setHeader('Set-Cookie', sessionCookie('', 0))
      json(response, 200, state(null, now))
      return
    }
    if (!session) fail(401, 'Войдите в игру.')
    if (!mutations.has(action)) fail(404, 'Действие не найдено.')
    db.transaction(() => mutate(session.id, action, data, now))
    json(response, 200, state(session.id, now))
  } catch (error) {
    if (!(error instanceof ApiError)) console.error(error)
    if (!response.headersSent) json(response, error.status ?? 500, { error: error.status ? error.message : 'Ошибка сервера.' })
    else response.end()
  }
}).listen(port, process.env.HOST ?? '127.0.0.1', () => console.log(`BrowAO · http://localhost:${port}`))
