const Router = require('express-promise-router')
const router = new Router()

const db = require('../db')

// For debugs
router.get('/dev-all-users', async (req, res) => {
    const { rows } = await db.query("SELECT * FROM users")
    res.json(rows)
})

router.get('/dev-all-rooms', async (req, res) => {
    const { rows } = await db.query("SELECT * FROM rooms")
    res.json(rows)
})

router.get('/dev-all-resources', async (req, res) => {
    const { rows } = await db.query("SELECT * FROM resources")
    res.json(rows)
})

router.get('/dev-all-likes', async (req, res) => {
    const { rows } = await db.query("SELECT * FROM likes")
    res.json(rows)
})

router.get('/dev-all-followers', async (req, res) => {
    const { rows } = await db.query("SELECT * FROM followers")
    res.json(rows)
})

router.get('/dev-all-comments', async (req, res) => {
    const { rows } = await db.query("SELECT * FROM comments")
    res.json(rows)
})

module.exports = router