// scripts/player.js - FIX: Remove periodic lag/stutter
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
let keepAliveInterval = null;
let audioContext = null;
let sourceNode = null;
let gainNode = null;
let isInitialized = false;
let isFading = false;

audio.volume = 1.0;

// ===========================
// AUDIO CONTEXT SETUP
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
    console.log('🎧 Audio Context initialized');
    
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
  } catch (e) {
    console.error('Audio Context failed:', e);
  }
}

function forceResumeAudioContext() {
  if (audioContext && audioContext.state !== 'running') {
    audioContext.resume().catch(e => {});
  }
}

['touchstart', 'touchend', 'click', 'keydown'].forEach(event => {
  document.addEventListener(event, forceResumeAudioContext, { once: false, passive: true });
});

// ===========================
// KEEP ALIVE - NON-INTRUSIVE (FIX FOR 5-SECOND LAG)
// ===========================
function startKeepAlive() {
  if (keepAliveInterval) return;
  
  console.log('💓 Keep-alive started (non-intrusive)');
  
  keepAliveInterval = setInterval(() => {
    // CRITICAL: Only check state, don't touch audio element during playback!
    
    // 1. Resume audio context if suspended (don't do anything if running)
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().catch(e => {});
    }
    
    // 2. Service worker ping (doesn't interrupt playback)
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      try {
        navigator.serviceWorker.controller.postMessage({
          type: 'PLAYBACK_ACTIVE',
          timestamp: Date.now()
        });
      } catch (e) {}
    }
    
    // 3. REMOVED: Don't touch audio properties during playback
    // 4. REMOVED: Don't update position state every interval
    
  }, 5000); // Run every 5 seconds but don't interrupt
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
    console.log('💔 Keep-alive stopped');
  }
}

// ===========================
// MEDIA SESSION API
// ===========================
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => play());
  navigator.mediaSession.setActionHandler('pause', () => pause());
  navigator.mediaSession.setActionHandler('nexttrack', () => playNextSong());
  navigator.mediaSession.setActionHandler('previoustrack', () => playPreviousSong());
  
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    if (details.seekTime != null && audio.duration) {
      audio.currentTime = details.seekTime;
    }
  });
  
  console.log('🎛️ Media Session ready');
}

function updateMediaSession(song) {
  if ('mediaSession' in navigator && song) {
    const artwork = song.thumbnail ? [
      { src: song.thumbnail, sizes: '96x96', type: 'image/jpeg' },
      { src: song.thumbnail, sizes: '128x128', type: 'image/jpeg' },
      { src: song.thumbnail, sizes: '192x192', type: 'image/jpeg' },
      { src: song.thumbnail, sizes: '256x256', type: 'image/jpeg' },
      { src: song.thumbnail, sizes: '384x384', type: 'image/jpeg' },
      { src: song.thumbnail, sizes: '512x512', type: 'image/jpeg' }
    ] : [];

    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title || 'Unknown Title',
      artist: song.artist || 'Unknown Artist',
      album: song.genre || 'MelodyTunes',
      artwork: artwork
    });
  }
}

function updatePositionState() {
  if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
    try {
      if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate,
          position: Math.min(audio.currentTime || 0, audio.duration)
        });
      }
    } catch (e) {}
  }
}

function setPlaybackState(state) {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = state;
  }
}

// ===========================
// VISIBILITY CHANGE
// ===========================
document.addEventListener('visibilitychange', async () => {
  const isHidden = document.hidden || document.visibilityState === 'hidden';
  
  if (isHidden) {
    if (!audio.paused) {
      console.log('📱 Backgrounded');
      
      if (audioContext && audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      
      setPlaybackState('playing');
    }
  } else {
    if (!audio.paused) {
      console.log('📱 Foregrounded');
      
      if (audioContext && audioContext.state === 'suspended') {
        await audioContext.resume();
      }
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
  
  console.log('🔊 Fade in (20s)');
  
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
  
  console.log('🔉 Fade out (10s)');
  
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
    console.log('📝 Playlist:', songs.length);
  },
  
  async playSong(song) {
    console.log('▶️ Playing:', song.title);
    
    currentSong = song;
    songPlayStartTime = Date.now();
    totalListenedTime = 0;
    hasCountedSong = false;

    initAudioContext();
    await new Promise(resolve => setTimeout(resolve, 50));

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

    const playWhenReady = () => {
      return new Promise((resolve, reject) => {
        if (audio.readyState >= 3) {
          resolve();
        } else {
          const canplayHandler = () => {
            audio.removeEventListener('canplaythrough', canplayHandler);
            audio.removeEventListener('error', errorHandler);
            resolve();
          };
          const errorHandler = () => {
            audio.removeEventListener('canplaythrough', canplayHandler);
            audio.removeEventListener('error', errorHandler);
            reject(new Error('Load failed'));
          };
          
          audio.addEventListener('canplaythrough', canplayHandler, { once: true });
          audio.addEventListener('error', errorHandler, { once: true });
          setTimeout(() => reject(new Error('Timeout')), 15000);
        }
      });
    };

    try {
      audio.load();
      await playWhenReady();
      
      if (audioContext && audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      
      await audio.play();
      
      console.log('✅ Playing');
      
      playBtn.textContent = 'pause';
      songPlayStartTime = Date.now();
      
      fadeIn();
      startKeepAlive();
      setPlaybackState('playing');
      updatePositionState();
      
    } catch (e) {
      console.error('❌ Play failed:', e);
      alert('Playback failed. Check connection.');
    }
  }
};

// ===========================
// PLAYBACK CONTROLS
// ===========================
function play() {
  initAudioContext();
  
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume().then(() => {
      audio.play().then(() => {
        playBtn.textContent = 'pause';
        songPlayStartTime = Date.now();
        
        if (audio.currentTime < 5 && gainNode) {
          fadeIn();
        }
        
        startKeepAlive();
        setPlaybackState('playing');
      }).catch(e => console.error('Play failed:', e));
    });
  } else {
    audio.play().then(() => {
      playBtn.textContent = 'pause';
      songPlayStartTime = Date.now();
      
      if (audio.currentTime < 5 && gainNode) {
        fadeIn();
      }
      
      startKeepAlive();
      setPlaybackState('playing');
    }).catch(e => console.error('Play failed:', e));
  }
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
  stopKeepAlive();
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
// AUDIO EVENT HANDLERS
// ===========================
audio.ontimeupdate = () => {
  if (audio.duration && !isNaN(audio.duration)) {
    seekBar.value = (audio.currentTime / audio.duration) * 100;
    
    // REMOVED: Don't update position state every time, only on seek
    
    // Start fade-out 10 seconds before end
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
  console.error('❌ Audio error:', audio.error);
  stopKeepAlive();
  
  setTimeout(() => {
    if (playlist.length > 0) {
      playNextSong();
    }
  }, 1000);
};

audio.onloadedmetadata = () => {
  updatePositionState();
};

seekBar.oninput = () => {
  if (audio.duration && !isNaN(audio.duration)) {
    audio.currentTime = (seekBar.value / 100) * audio.duration;
    updatePositionState(); // Only update on manual seek
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

console.log('🎵 Player loaded - 5-second lag FIXED');