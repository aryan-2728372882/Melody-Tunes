// scripts/player.js - MINIMAL: Remove ALL periodic operations
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
let fadeInterval = null;
let playlist = [];
let currentIndex = 0;
let audioContext = null;
let sourceNode = null;
let gainNode = null;
let isInitialized = false;
let isFading = false;

audio.volume = 1.0;

// ===========================
// AUDIO CONTEXT SETUP (ONE TIME ONLY)
// ===========================
function initAudioContext() {
  if (isInitialized) {
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().catch(e => {});
    }
    return;
  }

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContextClass({
      latencyHint: 'playback',
      sampleRate: 48000
    });
    
    gainNode = audioContext.createGain();
    gainNode.gain.value = 1.0;
    
    sourceNode = audioContext.createMediaElementSource(audio);
    sourceNode.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    isInitialized = true;
    console.log('🎧 Audio Context ready');
    
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
  } catch (e) {
    console.error('Audio Context failed:', e);
  }
}

// Resume on user interaction (one time setup)
['touchstart', 'click'].forEach(event => {
  document.addEventListener(event, () => {
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume();
    }
  }, { once: true, passive: true });
});

// ===========================
// MEDIA SESSION API (MINIMAL)
// ===========================
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => play());
  navigator.mediaSession.setActionHandler('pause', () => pause());
  navigator.mediaSession.setActionHandler('nexttrack', () => playNextSong());
  navigator.mediaSession.setActionHandler('previoustrack', () => playPreviousSong());
  console.log('🎛️ Media Session ready');
}

function updateMediaSession(song) {
  if ('mediaSession' in navigator && song) {
    const artwork = song.thumbnail ? [
      { src: song.thumbnail, sizes: '512x512', type: 'image/jpeg' }
    ] : [];

    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title || 'Unknown',
      artist: song.artist || 'Unknown',
      album: song.genre || 'Music',
      artwork: artwork
    });
  }
}

function setPlaybackState(state) {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = state;
  }
}

// ===========================
// VISIBILITY CHANGE (MINIMAL)
// ===========================
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !audio.paused) {
    console.log('📱 Backgrounded');
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume();
    }
  }
});

// ===========================
// PLAYER UI
// ===========================
function showPlayer() {
  playerEl.hidden = false;
  playerEl.classList.add('visible');
}

function hidePlayer() {
  playerEl.classList.remove('visible');
  setTimeout(() => {
    if (!audio.src) playerEl.hidden = true;
  }, 300);
}

// ===========================
// SMOOTH FADE USING GAIN NODE
// ===========================
function fadeIn() {
  if (!gainNode) return;
  
  if (fadeInterval) clearInterval(fadeInterval);
  isFading = true;
  
  audio.volume = 1.0;
  gainNode.gain.value = 0;
  
  const fadeDuration = 20000;
  const steps = 200;
  const stepDuration = fadeDuration / steps;
  const gainIncrement = 1.0 / steps;
  
  let currentStep = 0;
  
  fadeInterval = setInterval(() => {
    currentStep++;
    gainNode.gain.value = Math.min(currentStep * gainIncrement, 1.0);
    
    if (currentStep >= steps) {
      clearInterval(fadeInterval);
      fadeInterval = null;
      isFading = false;
    }
  }, stepDuration);
}

function fadeOut(callback) {
  if (!gainNode) {
    if (callback) callback();
    return;
  }
  
  if (fadeInterval) clearInterval(fadeInterval);
  isFading = true;
  
  audio.volume = 1.0;
  
  const fadeDuration = 10000;
  const steps = 100;
  const stepDuration = fadeDuration / steps;
  const startGain = gainNode.gain.value;
  const gainDecrement = startGain / steps;
  
  let currentStep = 0;
  
  fadeInterval = setInterval(() => {
    currentStep++;
    gainNode.gain.value = Math.max(startGain - (currentStep * gainDecrement), 0);
    
    if (currentStep >= steps || gainNode.gain.value <= 0) {
      clearInterval(fadeInterval);
      fadeInterval = null;
      isFading = false;
      if (callback) callback();
    }
  }, stepDuration);
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
    console.log('▶️', song.title);
    
    currentSong = song;
    songPlayStartTime = Date.now();
    totalListenedTime = 0;
    hasCountedSong = false;

    initAudioContext();

    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    audio.autoplay = false;
    audio.src = song.link;
    audio.volume = 1.0;
    
    titleEl.textContent = song.title;

    const thumbUrl = song.thumbnail || '';
    thumbEl.style.backgroundImage = `url(${thumbUrl})`;
    thumbEl.style.backgroundSize = 'cover';
    thumbEl.style.backgroundPosition = 'center';

    updateMediaSession(song);
    showPlayer();

    try {
      audio.load();
      
      // Wait for ready
      await new Promise((resolve, reject) => {
        if (audio.readyState >= 3) {
          resolve();
        } else {
          audio.addEventListener('canplaythrough', resolve, { once: true });
          audio.addEventListener('error', reject, { once: true });
          setTimeout(() => reject(new Error('Timeout')), 10000);
        }
      });
      
      if (audioContext && audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      
      await audio.play();
      
      playBtn.textContent = 'pause';
      songPlayStartTime = Date.now();
      
      fadeIn();
      setPlaybackState('playing');
      
    } catch (e) {
      console.error('Play failed:', e);
      alert('Playback failed');
    }
  }
};

// ===========================
// PLAYBACK CONTROLS
// ===========================
function play() {
  initAudioContext();
  
  audio.play().then(() => {
    playBtn.textContent = 'pause';
    songPlayStartTime = Date.now();
    
    if (audio.currentTime < 5 && gainNode) {
      fadeIn();
    }
    
    setPlaybackState('playing');
  }).catch(e => console.error('Play failed:', e));
}

function pause() {
  audio.pause();
  playBtn.textContent = 'play_arrow';
  
  if (songPlayStartTime > 0) {
    const sessionTime = (Date.now() - songPlayStartTime) / 1000;
    totalListenedTime += sessionTime;
    songPlayStartTime = 0;
  }
  
  if (fadeInterval) {
    clearInterval(fadeInterval);
    isFading = false;
  }
  setPlaybackState('paused');
}

playBtn.parentElement.onclick = () => {
  if (audio.paused) {
    play();
  } else {
    pause();
  }
};

prevBtn.disabled = false;
prevBtn.style.opacity = '1';
prevBtn.style.cursor = 'pointer';
prevBtn.onclick = () => {
  if (playlist.length > 0) {
    playPreviousSong();
  }
};

nextBtn.disabled = false;
nextBtn.style.opacity = '1';
nextBtn.style.cursor = 'pointer';
nextBtn.onclick = () => {
  if (playlist.length > 0) {
    playNextSong();
  }
};

repeatBtn.parentElement.onclick = () => {
  if (repeat === 'off') {
    repeat = 'one';
    repeatBtn.textContent = 'repeat_one';
  } else {
    repeat = 'off';
    repeatBtn.textContent = 'repeat';
  }
};

// ===========================
// AUDIO EVENT HANDLERS (MINIMAL)
// ===========================
audio.ontimeupdate = () => {
  if (audio.duration && !isNaN(audio.duration)) {
    // CRITICAL: Only update seek bar, nothing else!
    seekBar.value = (audio.currentTime / audio.duration) * 100;
    
    // Fade out check
    const timeRemaining = audio.duration - audio.currentTime;
    if (timeRemaining <= 10 && timeRemaining > 9.9 && !isFading && gainNode) {
      fadeOut(() => {
        if (repeat === 'one') {
          audio.currentTime = 0;
          songPlayStartTime = Date.now();
          totalListenedTime = 0;
          hasCountedSong = false;
          if (gainNode) gainNode.gain.value = 1.0;
          audio.play().then(() => fadeIn());
        }
      });
    }
  }

  // Stats check
  if (!hasCountedSong && !audio.paused && songPlayStartTime > 0) {
    const currentSessionTime = (Date.now() - songPlayStartTime) / 1000;
    const totalTime = totalListenedTime + currentSessionTime;
    
    if (totalTime >= 90) {
      hasCountedSong = true;
    }
  }
};

audio.onended = () => {
  if (fadeInterval) {
    clearInterval(fadeInterval);
    isFading = false;
  }
  
  if (songPlayStartTime > 0) {
    const sessionTime = (Date.now() - songPlayStartTime) / 1000;
    totalListenedTime += sessionTime;
    songPlayStartTime = 0;
  }
  
  if (hasCountedSong && totalListenedTime >= 90) {
    const exactMinutes = totalListenedTime / 60;
    const roundedMinutes = Math.round(exactMinutes * 2) / 2;
    updateUserStats(roundedMinutes);
  }
  
  if (repeat === 'one') {
    audio.currentTime = 0;
    songPlayStartTime = Date.now();
    totalListenedTime = 0;
    hasCountedSong = false;
    if (gainNode) gainNode.gain.value = 1.0;
    audio.play().then(() => fadeIn());
  } else {
    setTimeout(() => playNextSong(), 500);
  }
};

audio.onpause = () => {
  if (fadeInterval) {
    clearInterval(fadeInterval);
    isFading = false;
  }
};

audio.onerror = (e) => {
  console.error('Audio error:', audio.error);
  setTimeout(() => {
    if (playlist.length > 0) {
      playNextSong();
    }
  }, 1000);
};

seekBar.oninput = () => {
  if (audio.duration && !isNaN(audio.duration)) {
    audio.currentTime = (seekBar.value / 100) * audio.duration;
  }
};

// ===========================
// PLAYLIST NAVIGATION
// ===========================
function playNextSong() {
  if (hasCountedSong && songPlayStartTime > 0) {
    const sessionTime = (Date.now() - songPlayStartTime) / 1000;
    totalListenedTime += sessionTime;
    
    if (totalListenedTime >= 90) {
      const exactMinutes = totalListenedTime / 60;
      const roundedMinutes = Math.round(exactMinutes * 2) / 2;
      updateUserStats(roundedMinutes);
    }
  }
  
  if (playlist.length === 0) {
    pause();
    return;
  }
  
  currentIndex = (currentIndex + 1) % playlist.length;
  const nextSong = playlist[currentIndex];
  
  if (nextSong) {
    player.playSong(nextSong);
  } else {
    pause();
  }
}

function playPreviousSong() {
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    songPlayStartTime = Date.now();
    totalListenedTime = 0;
    hasCountedSong = false;
  } else if (playlist.length > 0) {
    currentIndex = (currentIndex - 1 + playlist.length) % playlist.length;
    const prevSong = playlist[currentIndex];
    if (prevSong) {
      player.playSong(prevSong);
    }
  }
}

// ===========================
// FIREBASE STATS
// ===========================
async function updateUserStats(minutesListened) {
  const user = auth.currentUser;
  if (!user || !currentSong) return;

  try {
    const userRef = doc(db, "users", user.uid);
    await updateDoc(userRef, {
      songsPlayed: increment(1),
      minutesListened: increment(minutesListened),
      lastPlayed: serverTimestamp(),
      country: "IN",
      xHandle: "@DesiDiamondSave",
      lastActive: new Date().toLocaleString('en-US', { 
        timeZone: 'Asia/Kolkata',
        month: 'long',
        day: 'numeric', 
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      }) + " IST"
    });
  } catch (e) {
    console.error('Stats failed:', e);
  }
}

// ===========================
// AUTH & PROFILE
// ===========================
onAuthStateChanged(auth, user => {
  if (!user) {
    location.href = "auth.html";
    return;
  }

  if (user.photoURL) {
    navAvatar.src = user.photoURL;
  } else {
    const initial = user.email?.[0]?.toUpperCase() || 'U';
    navAvatar.src = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='56'%3E%3Ccircle cx='28' cy='28' r='28' fill='%234a90e2'/%3E%3Ctext x='50%25' y='50%25' font-size='24' fill='white' text-anchor='middle' dy='.35em'%3E${initial}%3C/text%3E%3C/svg%3E`;
  }

  profileBtn.onclick = () => {
    if (user.email === "prabhakararyan2007@gmail.com") {
      location.href = "admin-dashboard.html";
    } else {
      location.href = "user-dashboard.html";
    }
  };
});

console.log('🎵 Minimal player - all periodic operations removed');