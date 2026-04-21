const form = document.getElementById('searchForm');
const zipInput = document.getElementById('zipInput');
const inputHint = document.getElementById('inputHint');
const loadingState = document.getElementById('loadingState');
const emptyState = document.getElementById('emptyState');
const emptyMessage = document.getElementById('emptyMessage');
const errorState = document.getElementById('errorState');
const errorMessage = document.getElementById('errorMessage');
const theaterList = document.getElementById('theaterList');

// Only allow digits in zip input
zipInput.addEventListener('input', () => {
  zipInput.value = zipInput.value.replace(/\D/g, '').slice(0, 5);
  inputHint.textContent = '';
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const zip = zipInput.value.trim();

  if (!/^\d{5}$/.test(zip)) {
    inputHint.textContent = 'Please enter a valid 5-digit US ZIP code.';
    zipInput.focus();
    return;
  }

  await searchShowtimes(zip);
});

function showState(state) {
  loadingState.classList.add('hidden');
  emptyState.classList.add('hidden');
  errorState.classList.add('hidden');
  theaterList.innerHTML = '';

  if (state === 'loading') loadingState.classList.remove('hidden');
  else if (state === 'empty') emptyState.classList.remove('hidden');
  else if (state === 'error') errorState.classList.remove('hidden');
}

async function searchShowtimes(zip) {
  showState('loading');

  try {
    const res = await fetch(`/api/showtimes?zip=${encodeURIComponent(zip)}`);
    const data = await res.json();

    if (!res.ok) {
      errorMessage.textContent = data.error || 'Failed to fetch showtimes.';
      showState('error');
      return;
    }

    if (!data.theaters || data.theaters.length === 0) {
      emptyMessage.textContent = data.message || 'No IMAX showtimes found near this ZIP code for the next 7 days.';
      showState('empty');
      return;
    }

    showState(null);
    console.log('First theater schedule:', JSON.stringify(data.theaters[0]?.schedule));
    renderTheaters(data.theaters);
  } catch (err) {
    errorMessage.textContent = 'Network error. Please check your connection and try again.';
    showState('error');
  }
}

function renderTheaters(theaters) {
  const rankLabels = ['Closest', '2nd Closest', '3rd Closest'];

  theaters.forEach((theater, idx) => {
    const card = document.createElement('div');
    card.className = 'theater-card';

    // Group schedule by day
    const byDay = {};
    (theater.schedule || []).forEach(entry => {
      const key = entry.day || entry.date || 'Unknown';
      if (!byDay[key]) byDay[key] = [];
      byDay[key].push(entry);
    });

    const scheduleHTML = Object.entries(byDay)
      .map(([day, entries]) => {
      const moviesHTML = entries.map(entry => `
        <div class="movie-row">
          ${entry.poster ? `<img class="movie-poster" src="${escapeHtml(entry.poster)}" alt="${escapeHtml(entry.movie)} poster" loading="lazy" />` : ''}
          <div class="movie-details">
            <div class="movie-title-row">
              <span class="movie-title">${escapeHtml(entry.movie)}</span>
              <span class="imax-badge">${escapeHtml(entry.format || 'IMAX')}</span>
            </div>
            <div class="times-list">
              ${(entry.times || []).map(t => `<span class="time-chip">${escapeHtml(t)}</span>`).join('')}
            </div>
          </div>
        </div>
      `).join('');

      const dayLabel = entries[0].date
        ? `<span class="day-name">${escapeHtml(day)},</span> <span class="day-date">${escapeHtml(entries[0].date)}</span>`
        : `<span class="day-name">${escapeHtml(day)}</span>`;

      return `
        <div class="day-group">
          <div class="day-label">${dayLabel}</div>
          ${moviesHTML}
        </div>
      `;
    }).join('');

    card.innerHTML = `
      <div class="theater-header">
        <div class="theater-info">
          <div class="theater-rank">${rankLabels[idx] || `#${idx + 1}`}</div>
          <div class="theater-name">${escapeHtml(theater.name)}</div>
          <div class="theater-address">${escapeHtml(theater.address)}</div>
        </div>
        ${theater.distance ? `<div class="theater-distance">${escapeHtml(theater.distance)}</div>` : ''}
      </div>
      <div class="theater-schedule">
        ${scheduleHTML || '<p style="color:var(--text-muted);font-size:0.9rem">No IMAX showtimes available.</p>'}
      </div>
    `;

    theaterList.appendChild(card);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
