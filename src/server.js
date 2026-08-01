'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { execFile } = require('child_process');
const { getAllScreenings, refreshScreenings } = require('./scrapers');

const PORT     = process.env.PORT || 3847;
const PID_FILE = '/tmp/cinema-ny-server.pid';
const app      = express();
const PUBLIC   = path.join(__dirname, 'public');

// Start scraping immediately on boot; hold the promise so GET / can wait on it
const warmup = getAllScreenings().catch(err => { console.error('[pre-warm]', err.message); return null; });

// Serve root with data pre-embedded so the page renders without a web spinner
app.get('/', async (req, res) => {
  try {
    const [html, initData] = await Promise.all([
      fs.promises.readFile(path.join(PUBLIC, 'index.html'), 'utf8'),
      warmup,
    ]);
    if (initData) {
      const injected = html.replace(
        '</head>',
        `<script>window.__INIT_DATA__=${JSON.stringify(initData)};</script></head>`
      );
      return res.send(injected);
    }
  } catch { /* fall through */ }
  res.sendFile(path.join(PUBLIC, 'index.html'));
});

app.use(express.static(PUBLIC));

app.get('/api/screenings', async (req, res) => {
  try {
    const data = await getAllScreenings();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/refresh', async (req, res) => {
  try {
    const data = await refreshScreenings();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/open', (req, res) => {
  const url = req.query.url;
  if (!url || !/^https?:\/\//.test(url)) return res.sendStatus(400);
  execFile('/usr/bin/open', [url], (err) => { if (err) console.error('Could not open URL:', err.message); });
  res.sendStatus(204);
});

if (process.env.MANAGED) {
  let shutdownTimer = null;

  app.post('/api/ping', (req, res) => {
    if (shutdownTimer) { clearTimeout(shutdownTimer); shutdownTimer = null; }
    res.sendStatus(204);
  });

  app.post('/api/shutdown', (req, res) => {
    res.sendStatus(204);
    shutdownTimer = setTimeout(() => shutdown(), 4000);
  });
}

// ── PID file + clean shutdown ─────────────────────────────────────────────────

function writePid() { try { fs.writeFileSync(PID_FILE, String(process.pid)); } catch {} }
function deletePid() { try { fs.unlinkSync(PID_FILE); } catch {} }

let activeServer = null;

function shutdown() {
  deletePid();
  if (activeServer) activeServer.close(() => process.exit(0));
  else process.exit(0);
}

// Kill whatever is on the port (via PID file + lsof), then retry binding.
function killStaleAndRetry(attempt) {
  if (attempt > 3) { console.error('[cinema-ny] Could not free port after 3 attempts, giving up.'); process.exit(1); }

  // Kill via PID file
  try {
    const old = parseInt(fs.readFileSync(PID_FILE, 'utf8'), 10);
    if (old && old !== process.pid) {
      try { process.kill(old, 'SIGKILL'); console.log(`[cinema-ny] Killed stale server PID ${old}`); } catch {}
    }
  } catch {}

  // Also kill anything lsof finds on the port (handles missing/stale PID file)
  execFile('/usr/sbin/lsof', ['-ti', `:${PORT}`], (_, out) => {
    (out || '').trim().split('\n').map(Number)
      .filter(p => p && p !== process.pid)
      .forEach(p => { try { process.kill(p, 'SIGKILL'); } catch {} });
    setTimeout(() => startListening(attempt + 1), 600);
  });
}

function startListening(attempt = 0) {
  const svr = app.listen(PORT, () => {
    activeServer = svr;
    writePid();
    const url = `http://localhost:${PORT}`;
    console.log(`\n🎬 Cinema NY ready at ${url}`);
    if (attempt === 0) console.log('   Press Ctrl+C to stop\n');
    if (!process.env.NO_OPEN) execFile('/usr/bin/open', [url], err => { if (err) console.error('Could not open browser:', err.message); });
  });

  svr.on('error', err => {
    if (err.code !== 'EADDRINUSE') { console.error(err); process.exit(1); }
    console.log('[cinema-ny] Port in use — killing stale server...');
    killStaleAndRetry(attempt);
  });
}

startListening();

process.on('SIGINT',  () => { console.log('\nShutting down...'); shutdown(); });
process.on('SIGTERM', () => shutdown());
process.on('SIGHUP',  () => shutdown());
process.on('exit',    () => deletePid());
