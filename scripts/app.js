// scripts/app.js
import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "firebase/auth";
import { player } from "./player.js";

/* DOM references */
const grid = document.getElementById("grid");
const searchGrid = document.getElementById("search-grid");
const searchInp = document.getElementById("search");
const profileBtn = document.getElementById("profile-btn");
const navAvatar = document.getElementById("nav-avatar");
const genreWrapper = document.getElementById("genre-wrapper");

/* Dropdown refs */
const genreBtn = document.getElementById("genre-btn");
const genreMenu = document.getElementById("genre-menu");
const genreLabel = document.getElementById("genre-label");
const genreItems = document.querySelectorAll(".genre-item");

/* initial UI state */
grid.hidden = false;
searchGrid.hidden = true;

let all = [];
let genres = {};
let active = "hindi";

/* THEME helper */
function setTheme(dark) {
  document.body.classList.toggle("dark-theme", dark);
  document.body.classList.toggle("light-theme", !dark);
  localStorage.setItem("vt-theme", dark ? "dark" : "light");
}
if (localStorage.getItem("vt-theme") === "dark") setTheme(true);

/* Click outside to close dropdown */
document.addEventListener("click", (e) => {
  if (!genreBtn.contains(e.target) && !genreMenu.contains(e.target)) {
    genreMenu.classList.remove("open");
    genreBtn.classList.remove("open");
    genreBtn.setAttribute("aria-expanded", "false");
    genreMenu.setAttribute("aria-hidden", "true");
  }
});

/* toggle dropdown */
genreBtn.onclick = () => {
  const isOpen = genreMenu.classList.toggle("open");
  genreBtn.classList.toggle("open", isOpen);
  genreBtn.setAttribute("aria-expanded", String(isOpen));
  genreMenu.setAttribute("aria-hidden", String(!isOpen));
};

/* genre click handling */
genreItems.forEach(item => {
  item.onclick = () => {
    const g = item.dataset.genre;
    genreItems.forEach(i => i.classList.remove("active"));
    item.classList.add("active");
    genreLabel.textContent = item.textContent;
    genreMenu.classList.remove("open");
    genreBtn.classList.remove("open");
    genreBtn.setAttribute("aria-expanded", "false");
    genreMenu.setAttribute("aria-hidden", "true");
    render(g);
  };
});

/* JSON loader + normalize keywords */
async function load(file) {
  try {
    const res = await fetch(file);
    if (!res.ok) return [];
    const data = await res.json();

    const genre = file.split("/").pop().replace(".json", "").toLowerCase();
    const normalized = data.map(s => {
      const song = { ...s };
      let kw = song.keywords || [];

      if (typeof kw === "string") {
        kw = kw.split(/[,;]/).map(x => x.trim());
      } else if (Array.isArray(kw)) {
        kw = kw.flatMap(k => (typeof k === "string" ? k.split(/[,;]/).map(x => x.trim()) : [])).filter(Boolean);
      } else {
        kw = [];
      }

      const extra = [
        ...(song.title ? song.title.split(/\s+/) : []),
        ...(song.artist ? song.artist.split(/[,&\/]+|\s+/) : [])
      ];

      song.keywords = Array.from(new Set([...kw, ...extra].map(w => (w || "").toLowerCase().trim()).filter(Boolean)));
      song.playCount = song.playCount || 0;
      return song;
    });

    genres[genre] = normalized;
    all.push(...normalized.map(s => ({ ...s, genre })));
  } catch (err) {
    console.error("Failed to load", file, err);
  }
}

/* create card element */
function card(song, songList, songIndex) {
  const el = document.createElement("div");
  el.className = "song-card";
  el.innerHTML = `
    <img src="${song.thumbnail || ''}" loading="lazy" alt="${(song.title||'').replace(/"/g,'')}" onerror="this.style.opacity=.4">
    <p>${escapeHtml(song.title || '')}</p>
    <p>${escapeHtml(song.artist || '')}</p>
  `;
  el.onclick = () => {
    player.setPlaylist(songList, songIndex);
    player.playSong(song);
  };
  return el;
}

/* render genre grid */
function render(genre) {
  active = genre;
  grid.hidden = false;
  searchGrid.hidden = true;
  genreWrapper.style.display = '';
  grid.innerHTML = "";
  const songList = genres[genre] || [];
  songList.forEach((s, idx) => grid.appendChild(card(s, songList, idx)));
}

/* simple, case-insensitive search */
function doSearch(qRaw) {
  const q = (qRaw || "").trim().toLowerCase();
  
  if (!q) {
    searchGrid.hidden = true;
    grid.hidden = false;
    searchInp.value = "";
    genreWrapper.style.display = '';
    return;
  }

  const matches = all.filter(song => {
    const titleMatch = (song.title || "").toLowerCase().includes(q);
    const artistMatch = (song.artist || "").toLowerCase().includes(q);
    const keywordMatch = (song.keywords || []).some(kw => kw.includes(q));
    return titleMatch || artistMatch || keywordMatch;
  });

  searchGrid.innerHTML = "";
  
  if (matches.length === 0) {
    searchGrid.innerHTML = '<p style="text-align:center;padding:3rem;color:#999;">No songs found</p>';
  } else {
    matches.forEach((s, idx) => searchGrid.appendChild(card(s, matches, idx)));
  }
  
  grid.hidden = true;
  searchGrid.hidden = false;
  genreWrapper.style.display = 'none'; // Hide genre selector when searching
}

/* bind search input */
searchInp.addEventListener("input", (e) => doSearch(e.target.value));
searchInp.addEventListener("keydown", (e) => { 
  if (e.key === "Enter") doSearch(searchInp.value);
  if (e.key === "Escape") {
    searchInp.value = "";
    doSearch("");
  }
});

/* auth guard + avatar */
onAuthStateChanged(auth, user => {
  if (!user) return (location.href = "auth.html");
  if (user.photoURL) navAvatar.src = user.photoURL;
  else {
    const initial = (user.email?.[0] || "U").toUpperCase();
    navAvatar.src = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='56'%3E%3Ccircle cx='28' cy='28' r='28' fill='%234a90e2'/%3E%3Ctext x='50%25' y='50%25' font-size='24' fill='white' text-anchor='middle' dy='.35em'%3E${initial}%3C/text%3E%3C/svg%3E`;
  }
});

/* small utility */
function escapeHtml(s) { 
  return (s||'').toString().replace(/[&<>"'`]/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;'
  }[c])); 
}

/* INIT - Load all genres */
(async () => {
  await Promise.all([
    load("/jsons/hindi.json"),
    load("/jsons/punjabi.json"),
    load("/jsons/haryanvi.json"),
    load("/jsons/bhojpuri.json"),
    load("/jsons/50s.json"),
    load("/jsons/remix.json"),
  ]);
  render("hindi");

  grid.hidden = false;
  searchGrid.hidden = true;
})();