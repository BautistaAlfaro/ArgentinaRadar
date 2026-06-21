/**
 * Alerts Service — Express Server
 *
 * Provides REST API endpoints for all alert/map layer data:
 *   GET /api/alerts/weather     — SMN weather alerts
 *   GET /api/alerts/earthquakes — USGS earthquake data
 *   GET /api/alerts/fires       — NASA FIRS fire hotspots
 *   GET /api/alerts/flights     — OpenSky flight tracking
 *   GET /health                 — Service health status
 *
 * Each data source refreshes on its own schedule (in-memory cache).
 * Port: 3007
 */

import express from 'express';
import { refreshWeatherAlerts, getWeatherAlerts } from './weatherAlerts.js';
import { refreshEarthquakes, getEarthquakes } from './earthquakes.js';
import { refreshFires, getFires } from './fires.js';
import { refreshFlights, getFlights } from './flights.js';

const PORT = parseInt(process.env.PORT || '3007', 10);

const app = express();
app.use(express.json());

// ─── CORS (allow web frontend) ─────────────────────────────────────
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ─── Status tracking ───────────────────────────────────────────────
const status = {
  weather: { lastRun: null as string | null, status: 'ok' as 'ok' | 'error', error: null as string | null },
  earthquakes: { lastRun: null as string | null, status: 'ok' as 'ok' | 'error', error: null as string | null },
  fires: { lastRun: null as string | null, status: 'ok' as 'ok' | 'error', error: null as string | null },
  flights: { lastRun: null as string | null, status: 'ok' as 'ok' | 'error', error: null as string | null },
};

const startTime = Date.now();

// ─── Initial data load ─────────────────────────────────────────────
async function initialFetch() {
  try {
    const weather = await refreshWeatherAlerts();
    status.weather = { lastRun: new Date().toISOString(), status: 'ok', error: null };
    console.log(`[Server] Loaded ${weather.length} weather alerts`);
  } catch (err) {
    status.weather.status = 'error';
    status.weather.error = (err as Error).message;
  }

  try {
    const earthquakes = await refreshEarthquakes();
    status.earthquakes = { lastRun: new Date().toISOString(), status: 'ok', error: null };
    console.log(`[Server] Loaded ${earthquakes.length} earthquakes`);
  } catch (err) {
    status.earthquakes.status = 'error';
    status.earthquakes.error = (err as Error).message;
  }

  try {
    const fires = await refreshFires();
    status.fires = { lastRun: new Date().toISOString(), status: 'ok', error: null };
    console.log(`[Server] Loaded ${fires.length} fire hotspots`);
  } catch (err) {
    status.fires.status = 'error';
    status.fires.error = (err as Error).message;
  }

  try {
    const flights = await refreshFlights();
    status.flights = { lastRun: new Date().toISOString(), status: 'ok', error: null };
    console.log(`[Server] Loaded ${flights.length} flights`);
  } catch (err) {
    status.flights.status = 'error';
    status.flights.error = (err as Error).message;
  }
}

// ─── Refresh timers (each source on its own schedule) ──────────────

// Weather: every 30 minutes
setInterval(async () => {
  try {
    await refreshWeatherAlerts();
    status.weather = { lastRun: new Date().toISOString(), status: 'ok', error: null };
  } catch (err) {
    status.weather.status = 'error';
    status.weather.error = (err as Error).message;
  }
}, 30 * 60 * 1000);

// Earthquakes: every 60 minutes
setInterval(async () => {
  try {
    await refreshEarthquakes();
    status.earthquakes = { lastRun: new Date().toISOString(), status: 'ok', error: null };
  } catch (err) {
    status.earthquakes.status = 'error';
    status.earthquakes.error = (err as Error).message;
  }
}, 60 * 60 * 1000);

// Fires: every 3 hours
setInterval(async () => {
  try {
    await refreshFires();
    status.fires = { lastRun: new Date().toISOString(), status: 'ok', error: null };
  } catch (err) {
    status.fires.status = 'error';
    status.fires.error = (err as Error).message;
  }
}, 3 * 60 * 60 * 1000);

// Flights: every 30 seconds
setInterval(async () => {
  try {
    await refreshFlights();
    status.flights = { lastRun: new Date().toISOString(), status: 'ok', error: null };
  } catch (err) {
    status.flights.status = 'error';
    status.flights.error = (err as Error).message;
  }
}, 30 * 1000);

// ─── Routes ────────────────────────────────────────────────────────

/** GET /api/alerts/weather — Return weather alerts */
app.get('/api/alerts/weather', async (_req, res) => {
  try {
    const alerts = await getWeatherAlerts();
    res.json({
      alerts,
      count: alerts.length,
      updatedAt: status.weather.lastRun,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** GET /api/alerts/earthquakes — Return earthquakes */
app.get('/api/alerts/earthquakes', async (_req, res) => {
  try {
    const earthquakes = await getEarthquakes();
    res.json({
      earthquakes,
      count: earthquakes.length,
      updatedAt: status.earthquakes.lastRun,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** GET /api/alerts/fires — Return fire hotspots */
app.get('/api/alerts/fires', async (_req, res) => {
  try {
    const fires = await getFires();
    res.json({
      fires,
      count: fires.length,
      updatedAt: status.fires.lastRun,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** GET /api/alerts/flights — Return flights */
app.get('/api/alerts/flights', async (_req, res) => {
  try {
    const flights = await getFlights();
    res.json({
      flights,
      count: flights.length,
      updatedAt: status.flights.lastRun,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** GET /health — Service status */
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    services: status,
  });
});

// ─── Start server ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[Alerts Server] Listening on http://localhost:${PORT}`);
  console.log('[Alerts Server] Loading initial data...');
  initialFetch().then(() => {
    console.log('[Alerts Server] Initial data loaded');
  });
});
