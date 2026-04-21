# IMAX Near Me

Find IMAX showtimes at the 3 closest theaters over the next 7 days by US ZIP code.

## Setup

1. Get a free SerpAPI key at https://serpapi.com (100 free searches/month)

2. Copy the env file and add your key:
   ```
   cp .env.example .env
   ```
   Then edit `.env` and set `SERPAPI_KEY=your_actual_key`

3. Install dependencies:
   ```
   npm install
   ```

4. Start the server:
   ```
   npm start
   ```

5. Open http://localhost:3000 in your browser

## How it works

- User enters a ZIP code
- Backend queries SerpAPI's Google Showtimes endpoint for IMAX movies near that ZIP
- Results are filtered to IMAX-format showings only
- The 3 closest theaters are returned with their full 7-day schedule
