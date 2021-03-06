const Router = require('express-promise-router')
const bcrypt = require('bcryptjs')
const db = require('../db')
const { insertResource } = require('./helpers/resourceHelper')

const router = new Router()

router.get('/rooms', async (req, res) => {
  const { room_id, password } = req.headers
  if (!room_id) return res.status(400).json({ error: "Can't get room data" })

  const query = `SELECT R.name, R.subject, R.private, R.password, R.time, R.teacher_id, U.name AS teacher_name
                   FROM rooms R
                   INNER JOIN users U
                   ON R.teacher_id=U.user_id AND R.room_id=${room_id}`

  const { rows: rooms } = await db.query(query)
  if (rooms.length == 0) return res.status(404).json({ error: 'Room not found' })

  if (rooms[0].private && rooms[0].password != password) return res.status(400).json({ error: 'Invalid password' })

  const resources = await db.query('SELECT resource_id, topic, video_url, file_url from resources WHERE room_id=$1 ORDER BY resource_id', [room_id])

  const likes = await db.query('SELECT user_id FROM likes WHERE room_id=$1', [room_id])

  const roomData = { ...rooms[0], resources: resources.rows, likes: likes.rows }
  res.json({ room: roomData })
})

router.post('/rooms', async (req, res) => {
  const { name, subject, private, password, resources, teacher_id, date_created } = req.body

  if (!(name && subject && typeof private === 'boolean' && resources && teacher_id && date_created))
    return res.status(400).json({ error: 'Please provide required fields' })

  if (private && !password) return res.status(400).json({ error: `Please provide room's password` })

  const { rows } = await db.query('SELECT name FROM rooms WHERE name=$1', [name])
  if (rows.length > 0) return res.status(400).json({ error: `Name "${name}" is already used` })

  const roomQuery = {
    name: 'insert-room',
    text: 'INSERT INTO rooms (name, subject, private, password, teacher_id, time) VALUES ($1, $2, $3, $4, $5, $6)',
    values: [name, subject, private, password && private ? password : null, teacher_id, date_created],
  }
  await db.query(roomQuery)

  const { rows: rooms } = await db.query('SELECT room_id FROM rooms WHERE name=$1', [name])
  const { room_id } = rooms[0]

  for (let resource of resources) {
    insertResource(resource, room_id)
  }

  res.json({ room: { room_id } })
})

router.get('/room-privacy', async (req, res) => {
  const { room_id } = req.headers
  if (!room_id) return res.status(400).json({ error: 'Please provide room_id' })

  const { rows } = await db.query('SELECT private FROM rooms WHERE room_id=$1', [room_id])
  if (rows.length == 0) return res.status(400).json({ error: 'Room not found' })
  else return res.json({ lock: rows[0].private })
})

router.delete('/rooms', async (req, res) => {
  const { room_id, teacher_id, password } = req.body

  if (!(room_id && teacher_id && password)) return res.status(400).json({ error: "Can't delete this room" })
  const { rows: users } = await db.query('SELECT password from users WHERE user_id=$1', [teacher_id])
  const validPass = await bcrypt.compare(password, users[0].password)
  if (!validPass) return res.status(400).json({ error: 'Invalid password' })

  const { rowCount } = await db.query('DELETE FROM rooms WHERE room_id=$1', [room_id])
  if (rowCount) {
    return res.json({ success: `Room ${room_id} was deleted` })
  } else {
    return res.status(400).json({ error: "Can't delete this room" })
  }
})

router.patch('/rooms', async (req, res) => {
  const { room_id, teacher_password, name, private, password, subject } = req.body

  if (!(room_id && teacher_password)) return res.status(400).json({ error: "Can't update room" })
  if (typeof teacher_password != 'string') return res.status(400).json({ error: 'Invalid password' })

  const roomQuery = `SELECT R.*, U.password AS user_password FROM rooms R
                       INNER JOIN users U
                       ON (R.teacher_id=U.user_id) AND (R.room_id=${room_id})`
  const { rows: rooms } = await db.query(roomQuery)

  if (rooms.length == 0) return res.status(404).json({ error: 'Rooom not found' })

  const validPass = await bcrypt.compare(teacher_password, rooms[0].user_password)
  if (!validPass) return res.status(400).json({ error: 'Invalid password' })

  if (private && !password) return res.status(400).json({ error: `Please provide room's password` })

  const { name: default_name, private: default_private, password: default_password, subject: default_subject } = rooms[0]
  const updateQuery = {
    name: 'update room',
    text: 'UPDATE rooms SET name=$1, private=$2, password=$3, subject=$4 WHERE room_id=$5',
    values: [
      name || default_name,
      typeof private == 'boolean' ? private : default_private,
      password || default_password,
      subject || default_subject,
      room_id,
    ],
  }

  const { rowCount } = await db.query(updateQuery)
  if (rowCount) res.json({ room: { room_id } })
  else res.status(400).json({ error: "Can't update this room" })
})

router.get('/my-rooms', async (req, res) => {
  const { user_id, limit } = req.headers
  if (!user_id) return res.status(400).json({ error: 'Please provide room_id' })

  const { rows: users } = await db.query('SELECT name FROM users WHERE user_id=$1', [user_id])
  if (users.length == 0) return res.status(404).json({ error: 'User not found' })

  const limitQuery = limit ? Number.parseInt(limit) : 6
  const roomQuery = `SELECT room_id, teacher_id, name, subject, private, time AS date_created
                       FROM rooms 
                       WHERE teacher_id=${user_id} 
                       ORDER BY time DESC
                       LIMIT ${limitQuery + 1}`
  const { rows: rooms } = await db.query(roomQuery)

  const have_more = rooms.length > limitQuery
  if (have_more) rooms.pop()

  const roomData = []
  for (let room of rooms) {
    const { room_id } = room
    const { rows: resources } = await db.query('SELECT resource_id, topic, video_url, file_url FROM resources WHERE room_id=$1', [room_id])
    const { rows: likes } = await db.query('SELECT user_id FROM likes WHERE room_Id=$1', [room_id])
    roomData.push({
      ...room,
      resource_length: resources.length,
      resources,
      teacher_name: users[0].name,
      likes: likes.length,
    })
  }

  res.json({ rooms: roomData, have_more })
})

router.post('/all-rooms', async (req, res) => {
  const { text, sort_by, arrange_by, limit } = req.body
  const queryStr = text ? text.toLowerCase() : ''
  
  const limitQuery = limit ? Number.parseInt(limit) : 6
  const query = `SELECT R.room_id, U.user_id AS teacher_id, U.name AS teacher_name, 
                        R.name, R.subject, R.private, R.time AS date_created, COUNT(likes.room_id) AS likes FROM users U
                 INNER JOIN rooms R
                 ON (U.user_id=R.teacher_id) 
                     and (
                           (LOWER(U.name) like '%${queryStr}%') 
                           or (LOWER(R.name) like '%${queryStr}%') 
                           or (LOWER(R.subject) like '%${queryStr}%')
                         )
                 LEFT JOIN likes
                 ON (R.room_id=likes.room_id)
                 GROUP BY (R.room_id, U.user_id, U.name, R.name, R.subject, R.private, R.time)
                 ORDER BY ${sort_by == 2 ? 'date_created' : 'likes'} ${arrange_by == 2 ? 'ASC' : 'DESC'}
                 LIMIT ${limitQuery + 1}`
  const { rows: rooms } = await db.query(query)

  const have_more = rooms.length > limitQuery
  if (have_more) rooms.pop()

  const roomData = []
  for (let room of rooms) {
    const { room_id } = room
    const { rows: resources } = await db.query('SELECT resource_id FROM resources WHERE room_id=$1', [room_id])
    roomData.push({ ...room, resource_length: resources.length })
  }

  res.json({ rooms: roomData, have_more })
})

router.get('/following-rooms', async (req, res) => {
  const { user_id, limit } = req.headers
  if (!user_id) res.status(400).json({ error: "Can't get your following rooms" })

  const limitQuery = limit ? Number.parseInt(limit) : 6
  const roomQuery = `SELECT R.room_id, T.teacher_id, U.name AS teacher_name, 
                              R.name, R.subject, R.private, R.time AS date_created,
                              COUNT(L.user_id) AS likes
                       FROM (SELECT teacher_id FROM followers WHERE student_id=${user_id}) AS T
                       INNER JOIN rooms R
                       ON R.teacher_id = T.teacher_id
                       INNER JOIN users U
                       ON T.teacher_id = U.user_id
                       LEFT JOIN likes L
                       ON L.room_id = R.room_id
                       GROUP BY (R.room_id, T.teacher_id, U.name, R.name, R.subject, R.private)
                       ORDER BY likes DESC
                       LIMIT ${limitQuery + 1}`
  const { rows: rooms } = await db.query(roomQuery)
  const have_more = rooms.length > limitQuery
  if (have_more) rooms.pop()

  const roomData = []
  for (let room of rooms) {
    const { room_id } = { room }
    const { rows: resources } = await db.query('SELECT room_id FROM resources WHERE room_id=$1', [room_id])
    roomData.push({ ...room, resource_length: resources.length })
  }

  res.json({ rooms: roomData, have_more })
})

module.exports = router
