// scripts/player.js - Enhanced Background Playback
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
let wakeLock = null;
let songPlayStartTime = 0;
let totalListenedTime = 0;
let hasCountedSong = false;
let fadeInterval = null;
let targetVolume = 1.0;
let playlist = [];
let currentIndex = 0;
let keepAliveInterval = null;
let audioContext = null;
let sourceNode = null;
let isBackgrounded = false;

audio.volume = 0;

// ===========================
// AUDIO CONTEXT SETUP
// ===========================
function initAudioContext() {
  if (!audioContext) {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioContextClass();
      
      // Connect audio element to context
      if (!sourceNode) {
        sourceNode = audioContext.createMediaElementSource(audio);
        sourceNode.connect(audioContext.destination);
      }
      
      console.log('🎧 Audio Context initialized');
    } catch (e) {
      console.error('Audio Context failed:', e);
    }
  }
  
  // Always try to resume if suspended
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume().then(() => {
      console.log('▶️ Audio Context resumed');
    });
  }
}

// ===========================
// KEEP ALIVE SYSTEM
// ===========================
function startKeepAlive() {
  if (keepAliveInterval) return;
  
  console.log('💓 Starting keep-alive system');
  
  keepAliveInterval = setInterval(() => {
    // 1. Ping service worker
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      const channel = new MessageChannel();
      navigator.serviceWorker.controller.postMessage({
        type: 'PLAYBACK_ACTIVE',
        timestamp: Date.now(),
        song: currentSong?.title
      }, [channel.port2]);
      
      channel.port1.onmessage = (e) => {
        if (e.data.received) {
          console.log('✅ Service worker alive');
        }
      };
    }
    
    // 2. Resume audio context if suspended
    if (audioContext) {
      if (audioContext.state === 'suspended') {
        audioContext.resume();
        console.log('🔄 Audio context resumed from keep-alive');
      }
    }
    
    // 3. Touch audio element to prevent GC
    if (!audio.paused && audio.readyState >= 2) {
      const currentTime = audio.currentTime;
      audio.currentTime = currentTime;
    }
    
    // 4. Update media session
    updatePositionState();
    
  }, 3000); // Every 3 seconds
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
  // Set up all handlers
  navigator.mediaSession.setActionHandler('play', () => play());
  navigator.mediaSession.setActionHandler('pause', () => pause());
  navigator.mediaSession.setActionHandler('nexttrack', () => playNextSong());
  navigator.mediaSession.setActionHandler('previoustrack', () => playPreviousSong());
  
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    if (details.seekTime != null && audio.duration) {
      audio.currentTime = details.seekTime;
      updatePositionState();
    }
  });
  
  navigator.mediaSession.setActionHandler('seekbackward', (details) => {
    const skipTime = details.seekOffset || 10;
    audio.currentTime = Math.max(audio.currentTime - skipTime, 0);
    updatePositionState();
  });
  
  navigator.mediaSession.setActionHandler('seekforward', (details) => {
    const skipTime = details.seekOffset || 10;
    audio.currentTime = Math.min(audio.currentTime + skipTime, audio.duration);
    updatePositionState();
  });
  
  console.log('🎛️ Media Session API configured');
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
          position: audio.currentTime || 0
        });
      }
    } catch (e) {
      // Silently fail - some browsers don't support this yet
    }
  }
}

function setPlaybackState(state) {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = state;
    console.log('🎵 Playback state:', state);
  }
}

// ===========================
// WAKE LOCK
// ===========================
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('🔒 Wake lock acquired');
      
      wakeLock.addEventListener('release', () => {
        console.log('🔓 Wake lock released');
      });
    }
  } catch (e) {
    console.warn('Wake lock failed:', e);
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().then(() => {
      wakeLock = null;
      console.log('Wake lock released manually');
    });
  }
}

// Re-acquire wake lock when page becomes visible
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && !audio.paused) {
    await requestWakeLock();
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
// FADE IN/OUT
// ===========================
function fadeIn() {
  if (fadeInterval) clearInterval(fadeInterval);
  
  audio.volume = 0;
  const fadeDuration = 15000;
  const steps = 150;
  const stepDuration = fadeDuration / steps;
  const volumeIncrement = targetVolume / steps;
  
  let currentStep = 0;
  
  fadeInterval = setInterval(() => {
    currentStep++;
    audio.volume = Math.min(currentStep * volumeIncrement, targetVolume);
    
    if (currentStep >= steps) {
      clearInterval(fadeInterval);
      fadeInterval = null;
    }
  }, stepDuration);
}

function fadeOut(callback) {
  if (fadeInterval) clearInterval(fadeInterval);
  
  const fadeDuration = 8000;
  const steps = 80;
  const stepDuration = fadeDuration / steps;
  const startVolume = audio.volume;
  const volumeDecrement = startVolume / steps;
  
  let currentStep = 0;
  
  fadeInterval = setInterval(() => {
    currentStep++;
    audio.volume = Math.max(startVolume - (currentStep * volumeDecrement), 0);
    
    if (currentStep >= steps || audio.volume <= 0) {
      clearInterval(fadeInterval);
      fadeInterval = null;
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
    console.log('📝 Playlist set:', songs.length, 'songs');
  },
  
  async playSong(song) {
    console.log('▶️ Playing:', song.title);
    
    currentSong = song;
    songPlayStartTime = Date.now();
    totalListenedTime = 0;
    hasCountedSong = false;

    // Initialize audio context
    initAudioContext();

    // Configure audio element
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    audio.src = song.link;
    titleEl.textContent = song.title;

    // Set thumbnail
    const thumbUrl = song.thumbnail || '';
    thumbEl.style.backgroundImage = `url(${thumbUrl})`;
    thumbEl.style.backgroundSize = 'cover';
    thumbEl.style.backgroundPosition = 'center';

    // Handle thumbnail errors
    const img = new Image();
    img.onerror = () => {
      thumbEl.style.backgroundImage = `url('data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2748%27 height=%2748%27%3E%3Crect width=%27100%25%27 height=%27100%25%27 fill=%27%23333%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 font-size=%2714%27 fill=%27%23999%27 text-anchor=%27middle%27 dy=%27.3em%27%3E♪%3C/text%3E%3C/svg%3E')`;
    };
    img.src = thumbUrl;

    // Update Media Session
    updateMediaSession(song);
    showPlayer();

    // Play audio
    try {
      await audio.play();
      playBtn.textContent = 'pause';
      songPlayStartTime = Date.now();
      fadeIn();
      await requestWakeLock();
      startKeepAlive();
      setPlaybackState('playing');
      updatePositionState();
    } catch (e) {
      console.error('Playback failed:', e);
      alert('Failed to play. Check your connection.');
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
    
    if (audio.currentTime < 15) {
      fadeIn();
    }
    
    requestWakeLock();
    startKeepAlive();
    setPlaybackState('playing');
    updatePositionState();
  }).catch(e => {
    console.error('Play failed:', e);
  });
}

function pause() {
  audio.pause();
  playBtn.textContent = 'play_arrow';
  
  if (songPlayStartTime > 0) {
    const sessionTime = (Date.now() - songPlayStartTime) / 1000;
    totalListenedTime += sessionTime;
    songPlayStartTime = 0;
    console.log('⏸️ Paused. Total:', totalListenedTime.toFixed(2), 's');
  }
  
  if (fadeInterval) clearInterval(fadeInterval);
  releaseWakeLock();
  stopKeepAlive();
  setPlaybackState('paused');
}

// Play/Pause button
playBtn.parentElement.onclick = () => {
  if (audio.paused) {
    play();
  } else {
    pause();
  }
};

// Previous button
prevBtn.disabled = false;
prevBtn.style.opacity = '1';
prevBtn.style.cursor = 'pointer';
prevBtn.onclick = () => {
  if (playlist.length > 0) {
    playPreviousSong();
  }
};

// Next button
nextBtn.disabled = false;
nextBtn.style.opacity = '1';
nextBtn.style.cursor = 'pointer';
nextBtn.onclick = () => {
  if (playlist.length > 0) {
    playNextSong();
  }
};

// Repeat button
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
  if (audio.duration) {
    seekBar.value = (audio.currentTime / audio.duration) * 100;
    updatePositionState();
    
    // Fade out before end
    const timeRemaining = audio.duration - audio.currentTime;
    if (timeRemaining <= 8 && timeRemaining > 7.9 && !fadeInterval && audio.volume > 0) {
      fadeOut(() => {
        if (repeat === 'one') {
          audio.currentTime = 0;
          songPlayStartTime = Date.now();
          totalListenedTime = 0;
          hasCountedSong = false;
          audio.play().then(() => fadeIn());
        }
      });
    }
  }

  // Check for 90 second threshold
  if (!hasCountedSong && !audio.paused && songPlayStartTime > 0) {
    const currentSessionTime = (Date.now() - songPlayStartTime) / 1000;
    const totalTime = totalListenedTime + currentSessionTime;
    
    if (totalTime >= 90) {
      hasCountedSong = true;
      console.log('✅ 90s threshold reached');
    }
  }
};

audio.onended = () => {
  if (fadeInterval) clearInterval(fadeInterval);
  
  if (songPlayStartTime > 0) {
    const sessionTime = (Date.now() - songPlayStartTime) / 1000;
    totalListenedTime += sessionTime;
    songPlayStartTime = 0;
  }
  
  if (hasCountedSong && totalListenedTime >= 90) {
    const exactMinutes = totalListenedTime / 60;
    const roundedMinutes = Math.round(exactMinutes * 2) / 2;
    console.log('🎵 Song ended:', roundedMinutes, 'min');
    updateUserStats(roundedMinutes);
  }
  
  if (repeat === 'one') {
    audio.currentTime = 0;
    songPlayStartTime = Date.now();
    totalListenedTime = 0;
    hasCountedSong = false;
    audio.play().then(() => fadeIn());
  } else {
    playNextSong();
  }
};

audio.onpause = () => {
  if (fadeInterval) clearInterval(fadeInterval);
  if (audio.currentTime === 0 || audio.ended) {
    hidePlayer();
  }
};

audio.onerror = (e) => {
  console.error('Audio error:', e);
  stopKeepAlive();
  
  // Auto-recover
  setTimeout(() => {
    if (playlist.length > 0) {
      console.log('🔄 Auto-recovery: playing next');
      playNextSong();
    }
  }, 2000);
};

audio.onwaiting = () => {
  console.log('⏳ Buffering...');
};

audio.oncanplay = () => {
  console.log('✅ Can play');
};

audio.onloadedmetadata = () => {
  console.log('📊 Metadata loaded, duration:', audio.duration);
  updatePositionState();
};

// Seek bar
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
  // Count current song if eligible
  if (hasCountedSong && songPlayStartTime > 0) {
    const sessionTime = (Date.now() - songPlayStartTime) / 1000;
    totalListenedTime += sessionTime;
    
    if (totalListenedTime >= 90) {
      const exactMinutes = totalListenedTime / 60;
      const roundedMinutes = Math.round(exactMinutes * 2) / 2;
      console.log('⏭️ Next. Total:', roundedMinutes, 'min');
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
    console.log('✅ Stats: +1 song, +' + minutesListened + ' min');
  } catch (e) {
    console.error('Stats update failed:', e);
  }
}

// ===========================
// VISIBILITY HANDLING
// ===========================
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    isBackgrounded = true;
    if (!audio.paused) {
      console.log('📱 App backgrounded, maintaining playback');
      startKeepAlive();
      
      // Ensure audio context stays active
      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
      }
    }
  } else {
    isBackgrounded = false;
    if (!audio.paused) {
      console.log('📱 App foregrounded');
      updatePositionState();
    }
  }
});

// Handle screen lock/unlock
document.addEventListener('freeze', () => {
  console.log('❄️ Page frozen');
  if (!audio.paused) {
    startKeepAlive();
  }
});

document.addEventListener('resume', () => {
  console.log('🔥 Page resumed');
  if (!audio.paused && audioContext) {
    audioContext.resume();
    updatePositionState();
  }
});

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

console.log('🎵 Player module loaded with background playback support');