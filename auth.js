const express = require('express');
const bcrypt = require('bcryptjs');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const DiscordStrategy = require('passport-discord').Strategy;
const pool = require('./db');

const router = express.Router();

router.use(express.json());
router.use(passport.initialize());
router.use(passport.session());

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const result = await pool.query('SELECT id, username, email, chips FROM users WHERE id = $1', [id]);
    done(null, result.rows[0] || null);
  } catch (err) {
    done(err, null);
  }
});

async function findOrCreateOAuthUser(provider, profileId, email, displayName) {
  const oauthCol = provider + '_id';

  const byOAuth = await pool.query(
    `SELECT id, username, email, chips FROM users WHERE ${oauthCol} = $1`,
    [profileId]
  );
  if (byOAuth.rows.length > 0) return byOAuth.rows[0];

  if (email) {
    const byEmail = await pool.query(
      'SELECT id, username, email, chips FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    if (byEmail.rows.length > 0) {
      await pool.query(`UPDATE users SET ${oauthCol} = $1 WHERE id = $2`, [profileId, byEmail.rows[0].id]);
      return byEmail.rows[0];
    }
  }

  let username = (displayName || provider + '_user').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 18);
  const existing = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
  if (existing.rows.length > 0) username += Math.floor(Math.random() * 999);

  const result = await pool.query(
    `INSERT INTO users (username, email, password_hash, ${oauthCol}) VALUES ($1, $2, $3, $4) RETURNING id, username, email, chips`,
    [username.slice(0, 20), email || `${provider}_${profileId}@oauth.local`, 'oauth_no_password', profileId]
  );
  return result.rows[0];
}

// Google OAuth
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: '/auth/google/callback',
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value;
      const user = await findOrCreateOAuthUser('google', profile.id, email, profile.displayName);
      done(null, user);
    } catch (err) {
      done(err, null);
    }
  }));

  router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

  router.get('/google/callback',
    passport.authenticate('google', { failureRedirect: '/?auth_error=google' }),
    (req, res) => {
      req.session.userId = req.user.id;
      req.session.save(() => res.redirect('/?authed=1'));
    }
  );
}

// Discord OAuth
if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) {
  passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: '/auth/discord/callback',
    scope: ['identify', 'email'],
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.email;
      const user = await findOrCreateOAuthUser('discord', profile.id, email, profile.username);
      done(null, user);
    } catch (err) {
      done(err, null);
    }
  }));

  router.get('/discord', passport.authenticate('discord'));

  router.get('/discord/callback',
    passport.authenticate('discord', { failureRedirect: '/?auth_error=discord' }),
    (req, res) => {
      req.session.userId = req.user.id;
      req.session.save(() => res.redirect('/?authed=1'));
    }
  );
}

router.get('/providers', (req, res) => {
  res.json({
    google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    discord: !!(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET),
  });
});

router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const trimmedUser = String(username).trim().slice(0, 20);
  const trimmedEmail = String(email).trim().toLowerCase();

  if (trimmedUser.length < 2) {
    return res.status(400).json({ error: 'Username must be at least 2 characters' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const existing = await pool.query(
      'SELECT id FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2)',
      [trimmedUser, trimmedEmail]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Username or email already taken' });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, chips',
      [trimmedUser, trimmedEmail, hash]
    );

    const user = result.rows[0];
    req.session.userId = user.id;
    req.session.save(() => {
      res.json({ id: user.id, username: user.username, email: user.email, chips: user.chips });
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const result = await pool.query(
      'SELECT id, username, email, password_hash, chips FROM users WHERE LOWER(email) = LOWER($1)',
      [String(email).trim()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    if (user.password_hash === 'oauth_no_password') {
      return res.status(401).json({ error: 'This account uses Google or Discord sign-in' });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    req.session.userId = user.id;
    req.session.save(() => {
      res.json({ id: user.id, username: user.username, email: user.email, chips: user.chips });
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Logout error:', err);
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

router.get('/me', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const result = await pool.query(
      'SELECT id, username, email, chips FROM users WHERE id = $1',
      [req.session.userId]
    );

    if (result.rows.length === 0) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Auth check error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Favorite Radio Stations ──

router.get('/radio/favorites', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const result = await pool.query(
      'SELECT id, station_name, station_url, favicon, country, tags FROM favorite_stations WHERE user_id = $1 ORDER BY created_at DESC',
      [req.session.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get favorites error:', err);
    res.status(500).json({ error: 'Failed to load favorites' });
  }
});

router.post('/radio/favorites', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const { name, url, favicon, country, tags } = req.body;
  if (!name || !url) {
    return res.status(400).json({ error: 'Station name and url are required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO favorite_stations (user_id, station_name, station_url, favicon, country, tags)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, station_url) DO NOTHING
       RETURNING id, station_name, station_url, favicon, country, tags`,
      [req.session.userId, String(name).slice(0, 255), url, favicon || '', country || '', tags || '']
    );
    if (result.rows.length === 0) {
      return res.json({ ok: true, duplicate: true });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Add favorite error:', err);
    res.status(500).json({ error: 'Failed to add favorite' });
  }
});

router.delete('/radio/favorites', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Station url is required' });
  }
  try {
    await pool.query(
      'DELETE FROM favorite_stations WHERE user_id = $1 AND station_url = $2',
      [req.session.userId, url]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Remove favorite error:', err);
    res.status(500).json({ error: 'Failed to remove favorite' });
  }
});

module.exports = router;
