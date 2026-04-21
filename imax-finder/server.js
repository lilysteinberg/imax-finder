require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const SERPAPI_BASE = 'https://serpapi.com/search.json';

// Simple in-memory cache: { [zip]: { data, expiresAt } }
const cache = {};
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getCached(zip) {
  const entry = cache[zip];
  if (entry && Date.now() < entry.expiresAt) return entry.data;
  return null;
}

function setCache(zip, data) {
  cache[zip] = { data, expiresAt: Date.now() + CACHE_TTL_MS };
}

// Step 1: Get list of movies currently playing in IMAX near a zip
async function getImaxMovieList(zip) {
  const params = new URLSearchParams({
    engine: 'google',
    q: 'movies in IMAX',
    location: zip,
    hl: 'en',
    gl: 'us',
    api_key: process.env.SERPAPI_KEY,
  });
  const res = await fetch(`${SERPAPI_BASE}?${params}`);
  if (!res.ok) throw new Error(`SerpAPI error ${res.status}`);
  const data = await res.json();
  return data?.knowledge_graph?.movies_playing || [];
}

// Step 2: Fetch showtimes for a specific movie using its serpapi_link, for a date offset
async function fetchMovieShowtimes(serpapiLink, dateOffset) {
  const url = new URL(serpapiLink);
  url.searchParams.set('api_key', process.env.SERPAPI_KEY);
  if (dateOffset > 0) url.searchParams.set('date', String(dateOffset));

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`SerpAPI error ${res.status}`);
  return res.json();
}

// Extract IMAX-only showings from a showtimes response
// Pass maxDays to limit how many days are processed (default 1)
function extractImaxShowings(data, movieName, moviePoster, maxDays = 1) {
  const results = [];
  (data.showtimes || []).slice(0, maxDays).forEach(dayData => {
    // SerpAPI returns day as a combined string e.g. "TodayApr 7" or "SatApr 11"
    // Split into day name and date by finding where the month starts
    const raw = dayData.day || 'Unknown';
    const match = raw.match(/^(Today|Tomorrow|Sun|Mon|Tue|Wed|Thu|Fri|Sat)(.*)/);
    const dayLabel = match ? match[1] : raw;
    const dateLabel = match ? match[2].trim() : '';

    (dayData.theaters || []).forEach(theater => {
      const imaxShowings = (theater.showing || []).filter(s =>
        s.type && s.type.toLowerCase().includes('imax')
      );
      if (imaxShowings.length === 0) return;

      results.push({
        theaterName: theater.name,
        address: theater.address || '',
        distance: theater.distance || '',
        distanceNum: parseFloat(theater.distance) || 9999,
        day: dayLabel,
        date: dateLabel,
        movie: movieName,
        poster: moviePoster || null,
        times: imaxShowings.flatMap(s => s.time || []),
        format: imaxShowings[0].type,
      });
    });
  });
  return results;
}

// Clear cache endpoint (dev utility)
app.get('/api/clear-cache', (req, res) => {
  Object.keys(cache).forEach(k => delete cache[k]);
  res.json({ ok: true });
});
app.get('/api/debug', async (req, res) => {
  const { zip } = req.query;
  if (!zip) return res.status(400).json({ error: 'zip required' });
  try {
    const movies = await getImaxMovieList(zip);
    res.json({ movies });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/showtimes', async (req, res) => {
  const { zip } = req.query;
  if (!zip || !/^\d{5}$/.test(zip)) {
    return res.status(400).json({ error: 'Please provide a valid 5-digit US zip code.' });
  }
  if (!process.env.SERPAPI_KEY || process.env.SERPAPI_KEY === 'your_serpapi_key_here') {
    return res.status(500).json({ error: 'SerpAPI key not configured. Add SERPAPI_KEY to your .env file.' });
  }

  try {
    const cached = getCached(zip);
    if (cached) {
      console.log(`Cache hit for ${zip}`);
      return res.json(cached);
    }

    // Get the list of IMAX movies currently playing
    const movies = await getImaxMovieList(zip);
    if (movies.length === 0) {
      return res.json({ theaters: [], message: 'No IMAX movies found near this zip code.' });
    }

    console.log(`Found ${movies.length} IMAX movies:`, movies.map(m => m.name));

    // For each movie, fetch all 7 days of showtimes in parallel
    const allShowings = [];

    await Promise.all(movies.map(async (movie) => {
      if (!movie.serpapi_link) return;

      const dayPromises = Array.from({ length: 1 }, (_, i) =>
        fetchMovieShowtimes(movie.serpapi_link, i)
          .then(data => {
            const showings = extractImaxShowings(data, movie.name, movie.image, 3);
            if (i === 0) console.log(`${movie.name}: ${showings.length} IMAX showings, showtimes days: ${data.showtimes?.length ?? 0}`);
            return showings;
          })
          .catch(err => {
            console.error(`Error fetching ${movie.name} day ${i}:`, err.message);
            return [];
          })
      );

      const days = await Promise.all(dayPromises);
      days.forEach(d => allShowings.push(...d));
    }));

    // Group by theater
    const theaterMap = {};
    allShowings.forEach(showing => {
      const key = showing.theaterName;
      if (!theaterMap[key]) {
        theaterMap[key] = {
          name: showing.theaterName,
          address: showing.address,
          distance: showing.distance,
          distanceNum: showing.distanceNum,
          schedule: [],
        };
      }
      // Deduplicate by day + movie
      const exists = theaterMap[key].schedule.some(
        s => s.day === showing.day && s.movie === showing.movie
      );
      if (!exists) {
        theaterMap[key].schedule.push({
          day: showing.day,
          date: showing.date,
          movie: showing.movie,
          poster: showing.poster,
          times: showing.times,
          format: showing.format,
        });
      }
    });

    // Sort by distance, return closest 3 theaters
    // Also cap each theater's schedule to 3 days
    const DAY_ORDER = ['Today', 'Tomorrow', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    const theaters = Object.values(theaterMap)
      .sort((a, b) => a.distanceNum - b.distanceNum)
      .slice(0, 3)
      .map(theater => {
        // Sort schedule by day order, then keep only first 3 unique days
        const sorted = theater.schedule.sort((a, b) => {
          const ai = DAY_ORDER.findIndex(d => a.day.startsWith(d));
          const bi = DAY_ORDER.findIndex(d => b.day.startsWith(d));
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        });
        const seenDays = [];
        const capped = sorted.filter(entry => {
          if (!seenDays.includes(entry.day)) seenDays.push(entry.day);
          return seenDays.indexOf(entry.day) < 3;
        });
        return { ...theater, schedule: capped };
      });

    console.log('All theaters found:', Object.values(theaterMap).map(t => `${t.name} (${t.distance})`));

    if (theaters.length === 0) {
      return res.json({ theaters: [], message: 'No IMAX showtimes found near this zip code for the next 7 days.' });
    }

    const response = { theaters };
    setCache(zip, response);
    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to fetch showtimes.' });
  }
});

app.listen(PORT, () => {
  console.log(`IMAX Finder running at http://localhost:${PORT}`);
});
