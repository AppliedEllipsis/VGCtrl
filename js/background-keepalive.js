/**
 * Background Keepalive System
 * 
 * Aggressive techniques to prevent Chrome from pausing Web Bluetooth connections
 * when the tab goes to the background.
 * 
 * Techniques used:
 * 1. Wake Lock API - keeps screen on
 * 2. Silent Audio Context - keeps audio thread alive
 * 3. Web Worker - runs timer in separate thread
 * 4. BroadcastChannel - keeps app alive via cross-tab communication
 * 5. No-op CSS animation - prevents some throttling
 * 6. MessageChannel - microtask scheduling
 * 7. Canvas rendering loop - keeps rendering thread alive
 * 8. Sync/periodic-sync APIs
 * 9. Aggressive interval pinging when hidden
 * 10. Tiny looping video element (Chrome prioritizes media tabs)
 */

class BackgroundKeepalive {
  constructor(options = {}) {
    this.onKeepaliveTick = options.onKeepaliveTick || (() => {});
    this.onWarn = options.onWarn || (() => {});
    this.interval = options.interval || 1000;
    
    this.isRunning = false;
    this.worker = null;
    this.audioContext = null;
    this.silentOscillator = null;
    this.silentGain = null;
    this.visibilityInterval = null;
    this.wakeLock = null;
    this.broadcastChannel = null;
    this.messageChannel = null;
    this.canvas = null;
    this.canvasCtx = null;
    this.animationFrame = null;
    this.noOpElement = null;
    this.notification = null;
    this.videoElement = null;
    
    this._handleVisibilityChange = this._handleVisibilityChange.bind(this);
    this._handleBeforeUnload = this._handleBeforeUnload.bind(this);
    this._broadcastPing = this._broadcastPing.bind(this);
    this._canvasLoop = this._canvasLoop.bind(this);
    this._messageChannelPing = this._messageChannelPing.bind(this);
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    
    console.log('[Keepalive] Starting aggressive background keepalive');
    
    this._acquireWakeLock();
    this._startWorker();
    this._startSilentAudio();
    this._startBroadcastChannel();
    this._startNoOpAnimation();
    this._startMessageChannel();
    this._startCanvasLoop();
    this._startVideoKeepalive();
    
    document.addEventListener('visibilitychange', this._handleVisibilityChange);
    window.addEventListener('beforeunload', this._handleBeforeUnload);
    
    this._registerPeriodicSync();
    this._showPersistentNotification();
    this._startAggressivePinging();
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    
    console.log('[Keepalive] Stopping keepalive systems');
    
    this._releaseWakeLock();
    this._stopWorker();
    this._stopSilentAudio();
    this._stopBroadcastChannel();
    this._stopNoOpAnimation();
    this._stopMessageChannel();
    this._stopCanvasLoop();
    this._stopVideoKeepalive();
    this._stopAggressivePinging();
    
    document.removeEventListener('visibilitychange', this._handleVisibilityChange);
    window.removeEventListener('beforeunload', this._handleBeforeUnload);
    
    if (this.notification) {
      this.notification.close();
      this.notification = null;
    }
  }

  // Wake Lock API - keeps screen on
  async _acquireWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
        console.log('[Keepalive] Wake Lock acquired');
        
        this.wakeLock.addEventListener('release', () => {
          console.log('[Keepalive] Wake Lock released');
          if (this.isRunning) {
            setTimeout(() => this._acquireWakeLock(), 100);
          }
        });
      } catch (err) {
        console.warn('[Keepalive] Wake Lock failed:', err);
      }
    }
  }

  _releaseWakeLock() {
    if (this.wakeLock) {
      this.wakeLock.release();
      this.wakeLock = null;
    }
  }

  // Web Worker for background execution
  _startWorker() {
    const workerCode = `
      let intervalId = null;
      let lastTick = Date.now();
      let messageCount = 0;
      
      self.onmessage = (e) => {
        if (e.data === 'start') {
          if (intervalId) clearInterval(intervalId);
          intervalId = setInterval(() => {
            const now = Date.now();
            const drift = now - lastTick - 1000;
            lastTick = now;
            self.postMessage({ type: 'tick', drift, timestamp: now });
          }, 1000);
        } else if (e.data === 'stop') {
          if (intervalId) clearInterval(intervalId);
          intervalId = null;
        } else if (e.data === 'ping') {
          messageCount++;
          self.postMessage({ type: 'ping', count: messageCount, timestamp: Date.now() });
        }
      };
    `;
    
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    this.worker = new Worker(URL.createObjectURL(blob));
    
    this.worker.onmessage = (e) => {
      if (e.data.type === 'tick') {
        if (e.data.drift > 200) {
          console.warn('[Keepalive] Timer drift:', e.data.drift, 'ms');
        }
        this.onKeepaliveTick(e.data);
      }
    };
    
    this.worker.postMessage('start');
  }

  _stopWorker() {
    if (this.worker) {
      this.worker.postMessage('stop');
      this.worker.terminate();
      this.worker = null;
    }
  }

  // Silent Audio - prevents audio thread suspension
  _startSilentAudio() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      
      this.audioContext = new AudioContext();
      
      this.silentOscillator = this.audioContext.createOscillator();
      this.silentGain = this.audioContext.createGain();
      
      this.silentGain.gain.value = 0.001;
      
      this.silentOscillator.connect(this.silentGain);
      this.silentGain.connect(this.audioContext.destination);
      
      this.silentOscillator.start();
      
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }
      
      this._audioCheckInterval = setInterval(() => {
        if (this.audioContext?.state === 'suspended') {
          this.audioContext.resume();
        }
      }, 1000);
    } catch (e) {
      console.warn('[Keepalive] Silent audio failed:', e);
    }
  }

  _stopSilentAudio() {
    if (this._audioCheckInterval) {
      clearInterval(this._audioCheckInterval);
      this._audioCheckInterval = null;
    }
    if (this.silentOscillator) {
      this.silentOscillator.stop();
      this.silentOscillator = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  // BroadcastChannel - cross-tab communication
  _startBroadcastChannel() {
    if (!('BroadcastChannel' in window)) return;
    
    try {
      this.broadcastChannel = new BroadcastChannel('pulsetto_keepalive');
      
      this.broadcastChannel.onmessage = (e) => {
        if (e.data === 'ping') {
          this.broadcastChannel.postMessage('pong');
        }
      };
      
      this._broadcastInterval = setInterval(this._broadcastPing, 500);
    } catch (e) {
      console.warn('[Keepalive] BroadcastChannel failed:', e);
    }
  }

  _broadcastPing() {
    if (this.broadcastChannel && this.isRunning) {
      this.broadcastChannel.postMessage('ping');
    }
  }

  _stopBroadcastChannel() {
    if (this._broadcastInterval) {
      clearInterval(this._broadcastInterval);
      this._broadcastInterval = null;
    }
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
  }

  // No-op CSS animation
  _startNoOpAnimation() {
    this.noOpElement = document.createElement('div');
    this.noOpElement.style.cssText = `
      position: fixed;
      top: -1px;
      left: -1px;
      width: 1px;
      height: 1px;
      opacity: 0;
      pointer-events: none;
    `;
    
    const style = document.createElement('style');
    style.textContent = `
      @keyframes noop-keepalive {
        0% { transform: translateX(0); }
        100% { transform: translateX(1px); }
      }
      .keepalive-anim {
        animation: noop-keepalive 0.5s linear infinite;
      }
    `;
    document.head.appendChild(style);
    this.noOpElement.className = 'keepalive-anim';
    
    document.body.appendChild(this.noOpElement);
  }

  _stopNoOpAnimation() {
    if (this.noOpElement) {
      this.noOpElement.remove();
      this.noOpElement = null;
    }
  }

  // MessageChannel - microtask scheduling
  _startMessageChannel() {
    try {
      this.messageChannel = new MessageChannel();
      
      this.messageChannel.port1.onmessage = () => {
        if (this.isRunning) {
          this._messageChannelPing();
        }
      };
      
      this._messageChannelPing();
    } catch (e) {
      console.warn('[Keepalive] MessageChannel failed:', e);
    }
  }

  _messageChannelPing() {
    if (this.messageChannel && this.isRunning) {
      this.messageChannel.port2.postMessage('ping');
    }
  }

  _stopMessageChannel() {
    if (this.messageChannel) {
      this.messageChannel.port1.close();
      this.messageChannel.port2.close();
      this.messageChannel = null;
    }
  }

  // Canvas rendering loop
  _startCanvasLoop() {
    try {
      this.canvas = document.createElement('canvas');
      this.canvas.width = 1;
      this.canvas.height = 1;
      this.canvas.style.cssText = 'position:fixed;top:-1px;left:-1px;opacity:0;pointer-events:none;';
      document.body.appendChild(this.canvas);
      
      this.canvasCtx = this.canvas.getContext('2d');
      
      let frameCount = 0;
      const loop = () => {
        if (!this.isRunning) return;
        
        frameCount++;
        this.canvasCtx.fillStyle = frameCount % 2 === 0 ? '#000' : '#001';
        this.canvasCtx.fillRect(0, 0, 1, 1);
        
        this.animationFrame = requestAnimationFrame(loop);
      };
      
      this.animationFrame = requestAnimationFrame(loop);
    } catch (e) {
      console.warn('[Keepalive] Canvas loop failed:', e);
    }
  }

  _stopCanvasLoop() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
      this.canvasCtx = null;
    }
  }

  // Video Keepalive - Chrome deprioritizes throttling for media-playing tabs
  _startVideoKeepalive() {
    try {
      // Create a tiny 1x1 pixel video element
      this.videoElement = document.createElement('video');
      this.videoElement.style.cssText = `
        position: fixed;
        top: -10px;
        left: -10px;
        width: 1px;
        height: 1px;
        opacity: 0;
        pointer-events: none;
        z-index: -9999;
      `;
      
      // Muted, looped, playsinline attributes to allow autoplay
      this.videoElement.setAttribute('muted', '');
      this.videoElement.setAttribute('autoplay', '');
      this.videoElement.setAttribute('loop', '');
      this.videoElement.setAttribute('playsinline', '');
      this.videoElement.muted = true;
      
      // Use a tiny data URI for a 1-second blank video
      // This is a minimal valid WebM (VP8 codec, 100ms duration, 2x2 pixels, silent)
      // Format: WebM (VP8 video + Vorbis audio, though audio is silent)
      const tinyWebM = 'data:video/webm;base64,GkXfowEAAAAAAAAfQoaBAUL3gQFC8oEEQvOBEDLoeBAICHxjHKmGGFXmZ2lnZYGDAAVQ2dlaQEAAQAAAH0EibWFgoaBkYBxgIABeyBtZWRpYaB5gIBnyw===';
      
      this.videoElement.src = tinyWebM;
      
      document.body.appendChild(this.videoElement);
      
      // Try to play
      this.videoElement.play().catch(err => {
        console.warn('[Keepalive] Video autoplay failed:', err);
        // Fallback: try playing on first user interaction
        const playOnInteraction = () => {
          this.videoElement?.play();
          document.removeEventListener('click', playOnInteraction);
          document.removeEventListener('touchstart', playOnInteraction);
        };
        document.addEventListener('click', playOnInteraction);
        document.addEventListener('touchstart', playOnInteraction);
      });
      
      console.log('[Keepalive] Video keepalive active');
    } catch (e) {
      console.warn('[Keepalive] Video keepalive failed:', e);
    }
  }

  _stopVideoKeepalive() {
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.src = '';
      this.videoElement.remove();
      this.videoElement = null;
    }
  }

  // Aggressive pinging when tab is hidden
  _startAggressivePinging() {
    if (document.hidden) {
      this._pingInterval = setInterval(() => {
        if (!this.isRunning) return;
        
        if (this.worker) {
          this.worker.postMessage('ping');
        }
        
        if (this.audioContext?.state === 'suspended') {
          this.audioContext.resume();
        }
        
        if (!this.wakeLock && 'wakeLock' in navigator) {
          this._acquireWakeLock();
        }
        
        this._broadcastPing();
        this._messageChannelPing();
        
      }, 250);
    }
  }

  _stopAggressivePinging() {
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
  }

  // Handle visibility changes
  _handleVisibilityChange() {
    const isHidden = document.hidden;
    
    if (isHidden) {
      console.log('[Keepalive] Tab hidden - activating countermeasures');
      this.onWarn('Tab in background - all keepalive systems active');
      
      if (this.audioContext?.state === 'suspended') {
        this.audioContext.resume();
      }
      
      this._startAggressivePinging();
    } else {
      console.log('[Keepalive] Tab visible');
      this._stopAggressivePinging();
      
      if (this.audioContext?.state === 'suspended') {
        this.audioContext.resume();
      }
    }
  }

  // Periodic Background Sync
  async _registerPeriodicSync() {
    if ('serviceWorker' in navigator && 'periodicSync' in self.registration) {
      try {
        const registration = await navigator.serviceWorker.ready;
        await registration.periodicSync.register('keepalive', {
          minInterval: 10 * 1000
        });
        console.log('[Keepalive] Periodic sync registered');
      } catch (e) {
        console.warn('[Keepalive] Periodic sync failed:', e);
      }
    }
  }

  // Persistent notification
  async _showPersistentNotification() {
    if (!('Notification' in window)) return;
    
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;
      
      const show = () => {
        this.notification = new Notification('Pulsetto Active', {
          body: 'Keep this tab visible for continuous stimulation',
          icon: '/icon.svg',
          badge: '/icon.svg',
          tag: 'pulsetto-keepalive',
          requireInteraction: true,
          silent: true,
          data: { type: 'keepalive' }
        });
      };
      
      show();
      
      this._notifInterval = setInterval(() => {
        if (this.isRunning) {
          if (this.notification) this.notification.close();
          show();
        }
      }, 5000);
      
    } catch (e) {
      console.warn('[Keepalive] Notification failed:', e);
    }
  }

  _stopNotificationRefresh() {
    if (this._notifInterval) {
      clearInterval(this._notifInterval);
      this._notifInterval = null;
    }
  }

  // Warn before leaving
  _handleBeforeUnload(e) {
    if (this.isRunning) {
      e.preventDefault();
      e.returnValue = 'Session active. Leaving will stop stimulation.';
      return e.returnValue;
    }
  }
}

if (typeof window !== 'undefined') {
  window.BackgroundKeepalive = BackgroundKeepalive;
}
