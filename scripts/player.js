// scripts/player.js - FULLY FIXED: Smooth Fade + Zero Stuttering (2025 Best Practices)
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "firebase/auth";
import { doc, updateDoc, increment, serverTimestamp } from "firebase/firestore";

const audio = document.getElementById('audio');
const titleEl = document.getElementById('player-title');
const thumbEl = document.querySelector('.thumb-placeholder');
const playBtn = document.getElementById('play-pause').querySelector('span');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');
const repeatBtn = document.getElementById('repeat').querySelector('span');
const seekBar = document.getElementById('seek');
const playerEl = document.getElementById('player');
const navAvatar = document.getElementById('nav-avatar');
const profileBtn = document.getElementById('profile-btn');

let currentSong = null;
let repeat = 'off';
let songPlayStartTime = 0;
let totalListenedTime = 0;
let hasCountedSong = false;
let playlist = [];
let currentIndex = 0;
let keepAliveInterval = null;

let audioContext = null;
let sourceNode = null;
let gainNode = null;
let isInitialized = false;
let isFading = false;

// CRITICAL: Always keep audio.volume = 1.0 → use gainNode only for volume control
audio.volume = 1.0;

// ===========================
// AUDIO CONTEXT SETUP (Fixed & Optimized)
// ===========================
function initAudioContext() {
  if (isInitialized) {
    if (audioContext?.state === 'suspended') audioContext.resume();
    return;
  }

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContextClass({ latencyHint: 'playback' });

    gainNode = audioContext.createGain();
    gainNode.gain.setValueAtTime(0, audioContext.currentTime); // Start silent

    sourceNode = audioContext.createMediaElementSource(audio);
    sourceNode.connect(gainNode);
    gainNode.connect(audioContext.destination);

    isInitialized = true;
    console.log('Audio Context + Gain Node initialized');
  } catch (e) {
    console.error('AudioContext init failed:', e);
  }
}

function resumeAudioContext() {
  if (audioContext?.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
}

// Resume on any user interaction
['click', 'touchstart', 'keydown'].forEach(evt =>
  document.addEventListener(evt, resumeAudioContext, { passive: true })
);

// ===========================
// SMOOTH FADE USING Web Audio API (60fps, perfect curve)
// ===========================
function fadeIn(duration = 8000) {
  if (!gainNode || isFading) return;
  isFading = true;

  gainNode.gain.cancelScheduledValues(audioContext.currentTime);
  gainNode.gain.setValueAtTime(0, audioContext.currentTime);
  gainNode.gain.linearRampToValueAtTime(1.0, audioContext.currentTime + duration / 1000);

  setTimeout(() => isFading = false, duration);
  console.log(`Fade-in started (${duration}ms)`);
}

function fadeOut(duration = 6000, callback) {
  if (!gainNode || isFading) {
    callback?.();
    return;
  }
  isFading = true;

  gainNode.gain.cancelScheduledValues(audioContext.currentTime);
  gainNode.gain.setValueAtTime(gainNode.gain.value, audioContext.currentTime);
  gainNode.gain.linearRampToValueAtTime(0.0001, audioContext.currentTime + duration / 1000);

  setTimeout(() => {
    isFading = false;
    callback?.();
  }, duration + 50);
}

// ===========================
// KEEP-ALIVE: FIXED — NO MORE STUTTERING!
// ===========================
function startKeepAlive() {
  if (keepAliveInterval) return;

  keepAliveInterval = setInterval(() => {
    resumeAudioContext();
    updatePositionState();

    // Notify service worker (optional)
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'KEEP_ALIVE' });
    }
  }, 12000); // Every 12s is sufficient
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

// ===========================
// MEDIA SESSION API
// ===========================
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', play);
  navigator.mediaSession.setActionHandler('pause', pause);
  navigator.mediaSession.setActionHandler('nexttrack', playNextSong);
  navigator.mediaSession.setActionHandler('previoustrack', playPreviousSong);
  navigator.mediaSession.setActionHandler('seekto', details => {
    if (details.seekTime != null && audio.duration) {
      audio.currentTime = details.seekTime;
      updatePositionState();
    }
  });
}

function updateMediaSession(song) {
  if (!('mediaSession' in navigator) || !song) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title || 'Unknown',
    artist: song.artist || 'Unknown Artist',
    album: song.genre || 'MelodyTunes',
    artwork: song.thumbnail ? [
      { src: song.thumbnail, sizes: '512x512', type: 'image/jpeg' }
    ] : []
  });
}

function updatePositionState() {
  if ('setPositionState' in navigator.mediaSession && audio.duration) {
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate,
        position: audio.currentTime
      });
    } catch (e) {}
  }
}

function setPlaybackState(state) {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = state;
  }
}

// ===========================
// PLAYER UI
// ===========================
function showPlayer() {
  playerEl.hidden = false;
  playerEl.classList.add('visible');
}

function hidePlayer() {
  playerEl.classList.remove('visible');
  setTimeout(() => { if (!audio.src) playerEl.hidden = true; }, 300);
}

// ===========================
// MAIN PLAYER EXPORT
// ===========================
export const player = {
  setPlaylist(songs, index = 0) {
    playlist = songs;
    currentIndex = index;
  },

  async playSong(song) {
    if (!song?.link) return;

    currentSong = song;
    songPlayStartTime = Date.now();
    totalListenedTime = 0;
    hasCountedSong = false;

    initAudioContext();
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    audio.src = song.link;

    titleEl.textContent = song.title;
    thumbEl.style.backgroundImage = song.thumbnail ? `url(${song.thumbnail})` : '';
    updateMediaSession(song);
    showPlayer();

    try {
      audio.load();
      await audio.play();
      playBtn.textContent = 'pause';
      setPlaybackState('playing');
      startKeepAlive();
      fadeIn(8000); // 8-second professional fade-in
      console.log('Now playing:', song.title);
    } catch (err) {
      console.error('Play failed:', err);
      alert('Playback failed. Trying next...');
      setTimeout(playNextSong, 1000);
    }
  }
};

// ===========================
// PLAYBACK CONTROLS
// ===========================
function play() {
  resumeAudioContext();
  audio.play().then(() => {
    playBtn.textContent = 'pause';
    songPlayStartTime = Date.now();
    startKeepAlive();
    setPlaybackState('playing');
    if (audio.currentTime < 5) fadeIn(6000);
  }).catch(console.error);
}

function pause() {
  audio.pause();
  playBtn.textContent = 'play_arrow';
  if (songPlayStartTime) {
    totalListenedTime += (Date.now() - songPlayStartTime) / 1000;
    songPlayStartTime = 0;
  }
  stopKeepAlive();
  setPlaybackState('paused');
}

playBtn.parentElement.onclick = () => audio.paused ? play() : pause();
prevBtn.onclick = () => playlist.length && playPreviousSong();
nextBtn.onclick = () => playlist.length && playNextSong();

repeatBtn.parentElement.onclick = () => {
  repeat = repeat === 'off' ? 'one' : 'off';
  repeatBtn.textContent = repeat === 'one' ? 'repeat_one' : 'repeat';
};

// ===========================
// AUDIO EVENT HANDLERS
// ===========================
audio.ontimeupdate = () => {
  if (!audio.duration) return;
  seekBar.value = (audio.currentTime / audio.duration) * 100;

  // Auto fade-out 12 seconds before end
  const remaining = audio.duration - audio.currentTime;
  if (remaining <= 12 && remaining > 11.5 && !isFading) {
    fadeOut(10000, () => {
      if (repeat === 'one') {
        audio.currentTime = 0;
        audio.play();
        fadeIn(8000);
      }
    });
  }

  // Count song after 90 seconds
  if (!hasCountedSong && !audio.paused && songPlayStartTime) {
    const total = totalListenedTime + (Date.now() - songPlayStartTime) / 1000;
    if (total >= 90) {
      hasCountedSong = true;
      console.log('90s listened — counted');
    }
  }
};

audio.onended = () => {
  if (songPlayStartTime) {
    totalListenedTime += (Date.now() - songPlayStartTime) / 1000;
  }

  if (hasCountedSong && totalListenedTime >= 90) {
    const minutes = Math.round((totalListenedTime / 60) * 2) / 2;
    updateUserStats(minutes);
  }

  if (repeat === 'one') {
    audio.currentTime = 0;
    songPlayStartTime = Date.now();
    totalListenedTime = 0;
    hasCountedSong = false;
    audio.play().then(() => fadeIn(8000));
  } else {
    setTimeout(playNextSong, 400);
  }
};

audio.onerror = () => {
  console.error('Audio error:', audio.error);
  setTimeout(playNextSong, 1500);
};

audio.onwaiting = () => console.log('Buffering...');
audio.oncanplay = () => console.log('Ready');
audio.onloadedmetadata = () => updatePositionState();

seekBar.oninput = () => {
  if (audio.duration) {
    audio.currentTime = (seekBar.value / 100) * audio.duration;
    updatePositionState();
  }
};

// ===========================
// PLAYLIST NAVIGATION
// ===========================
function playNextSong() {
  if (playlist.length === 0) return pause();
  currentIndex = (currentIndex + 1) % playlist.length;
  player.playSong(playlist[currentIndex]);
}

function playPreviousSong() {
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    totalListenedTime = 0;
    hasCountedSong = false;
    songPlayStartTime = Date.now();
  } else if (playlist.length > 0) {
    currentIndex = (currentIndex - 1 + playlist.length) % playlist.length;
    player.playSong(playlist[currentIndex]);
  }
}

// ===========================
// FIREBASE STATS
// ===========================
async function updateUserStats(minutes) {
  const user = auth.currentUser;
  if (!user || !currentSong) return;

  try {
    await updateDoc(doc(db, "users", user.uid), {
      songsPlayed: increment(1),
      minutesListened: increment(minutes),
      lastPlayed: serverTimestamp(),
      lastActive: new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }) + " IST"
    });
    console.log(`Stats updated: +${minutes} min`);
  } catch (e) {
    console.error("Stats update failed:", e);
  }
}

// ===========================
// AUTH & PROFILE
// ===========================
onAuthStateChanged(auth, user => {
  if (!user) return location.href = "auth.html";

  navAvatar.src = user.photoURL || `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='56' height='56'><circle cx='28' cy='28' r='28' fill='%234a90e2'/><text x='50%' y='50%' font-size='28' fill='white' text-anchor='middle' dy='.3em'>${(user.email?.[0] || 'U').toUpperCase()}</text></svg>`;

  profileBtn.onclick = () => {
    location.href = user.email === "prabhakararyan2007@gmail.com" ? "admin-dashboard.html" : "user-dashboard.html";
  };
});

// Background handling
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !audio.paused) {
    resumeAudioContext();
    updatePositionState();
  }
});

console.log('Player.js loaded — Smooth Fade + Zero Lag Fixed (2025)');