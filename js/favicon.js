/**
 * Dynamic favicon generator - shows session state in tab icon
 * Displays: connection status, play/pause, intensity, channel
 */
class DynamicFavicon {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 64;
    this.canvas.height = 64;
    this.ctx = this.canvas.getContext('2d');

    // State tracking
    this.state = {
      connected: false,
      running: false,
      paused: false,
      intensity: 0,
      channel: 'bilateral' // 'left', 'right', 'bilateral'
    };

    // Color scheme
    this.colors = {
      disconnected: '#6b7280', // gray
      connected: '#22c55e',    // green
      running: '#3b82f6',      // blue
      paused: '#eab308',       // yellow
      background: '#0d1117',
      text: '#ffffff',
      textMuted: '#8b949e'
    };

    // DOM elements
    this.staticLink = document.getElementById('favicon-static');
    this.dynamicLink = document.getElementById('favicon-dynamic');

    // Debounce render
    this._renderPending = false;
  }

  /**
   * Update state and trigger render
   */
  setState(updates) {
    Object.assign(this.state, updates);
    this._scheduleRender();
  }

  /**
   * Update individual properties
   */
  setConnected(connected) {
    this.setState({ connected });
  }

  setRunning(running) {
    this.setState({ running });
  }

  setPaused(paused) {
    this.setState({ paused });
  }

  setIntensity(intensity) {
    this.setState({ intensity });
  }

  setChannel(channel) {
    this.setState({ channel });
  }

  /**
   * Schedule render with debouncing
   */
  _scheduleRender() {
    if (this._renderPending) return;
    this._renderPending = true;

    requestAnimationFrame(() => {
      this._render();
      this._renderPending = false;
    });
  }

  /**
   * Render the favicon canvas
   */
  _render() {
    const { ctx, canvas } = this;
    const { width, height } = canvas;

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Determine main status color
    let statusColor = this.colors.disconnected;
    if (this.state.connected) {
      if (this.state.running) {
        statusColor = this.colors.running;
      } else if (this.state.paused) {
        statusColor = this.colors.paused;
      } else {
        statusColor = this.colors.connected;
      }
    }

    // Background with rounded corners (simulated with circle for favicon)
    ctx.fillStyle = this.colors.background;
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, 12);
    ctx.fill();

    // Outer ring - connection status
    ctx.strokeStyle = statusColor;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(width/2, height/2, 28, 0, Math.PI * 2);
    ctx.stroke();

    // Inner fill based on state
    if (this.state.connected) {
      ctx.fillStyle = statusColor + '20'; // 12% opacity hex
      ctx.beginPath();
      ctx.arc(width/2, height/2, 22, 0, Math.PI * 2);
      ctx.fill();
    }

    // Play/Pause/Stop indicator in center
    ctx.fillStyle = statusColor;
    if (this.state.running) {
      // Pause symbol (two bars)
      const barWidth = 6;
      const barHeight = 16;
      const gap = 4;
      ctx.fillRect(width/2 - gap/2 - barWidth, height/2 - barHeight/2, barWidth, barHeight);
      ctx.fillRect(width/2 + gap/2, height/2 - barHeight/2, barWidth, barHeight);
    } else if (this.state.paused) {
      // Play symbol (triangle)
      ctx.beginPath();
      ctx.moveTo(width/2 - 4, height/2 - 8);
      ctx.lineTo(width/2 - 4, height/2 + 8);
      ctx.lineTo(width/2 + 8, height/2);
      ctx.closePath();
      ctx.fill();
    } else if (!this.state.connected) {
      // X symbol for disconnected
      ctx.lineWidth = 3;
      ctx.strokeStyle = statusColor;
      ctx.beginPath();
      ctx.moveTo(width/2 - 6, height/2 - 6);
      ctx.lineTo(width/2 + 6, height/2 + 6);
      ctx.moveTo(width/2 + 6, height/2 - 6);
      ctx.lineTo(width/2 - 6, height/2 + 6);
      ctx.stroke();
    }

    // Intensity number (if > 0 and running/paused)
    if (this.state.intensity > 0 && (this.state.running || this.state.paused)) {
      ctx.fillStyle = this.colors.text;
      ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(this.state.intensity), width/2, height/2 + 18);
    }

    // Channel indicator dot (L/R/B or color)
    if (this.state.connected) {
      const dotY = 10;
      const dotX = width/2;

      // Channel colors
      let channelColor = this.colors.textMuted;
      switch (this.state.channel) {
        case 'left':
          channelColor = '#60a5fa'; // blue
          break;
        case 'right':
          channelColor = '#f472b6'; // pink
          break;
        case 'bilateral':
          channelColor = '#a78bfa'; // purple
          break;
      }

      ctx.fillStyle = channelColor;
      ctx.beginPath();
      ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
      ctx.fill();

      // Small L/R/B letter
      ctx.fillStyle = this.colors.background;
      ctx.font = '7px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const letter = this.state.channel === 'bilateral' ? 'B' :
                     this.state.channel === 'left' ? 'L' : 'R';
      ctx.fillText(letter, dotX, dotY + 0.5);
    }

    // Update favicon link
    this._updateLink();
  }

  /**
   * Update the favicon link element
   */
  _updateLink() {
    if (!this.dynamicLink) return;

    const dataUrl = this.canvas.toDataURL('image/png');

    // Only update if changed (prevent flickering)
    if (this.dynamicLink.href !== dataUrl) {
      this.dynamicLink.href = dataUrl;
      this.dynamicLink.style.display = '';
      if (this.staticLink) {
        this.staticLink.style.display = 'none';
      }
    }
  }

  /**
   * Reset to static favicon
   */
  reset() {
    if (this.dynamicLink) {
      this.dynamicLink.style.display = 'none';
    }
    if (this.staticLink) {
      this.staticLink.style.display = '';
    }
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.DynamicFavicon = DynamicFavicon;
}
