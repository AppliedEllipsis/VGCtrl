#!/usr/bin/env node
/**
 * HTTPS Server for VG Ctrl Web App
 * 
 * Serves the app with HTTPS (required for Web Bluetooth API)
 * Auto-detects local IP and shows clickable terminal links
 * 
 * Features:
 * - Auto-generates self-signed HTTPS certificate
 * - Detects all local network interfaces
 * - Displays clickable URLs using OSC 8 terminal hyperlinks
 * - SPA fallback for client-side routing
 * - COOP/COEP headers for SharedArrayBuffer support
 * 
 * Usage:
 *   node server.js                          # Default port 8443
 *   PORT=9000 node server.js              # Custom port (Unix/Mac)
 *   $env:PORT=9000; node server.js        # Custom port (PowerShell)
 *   set PORT=9000 && node server.js       # Custom port (CMD)
 *   HOST=192.168.1.5 node server.js         # Bind to specific IP
 * 
 * Terminal Clickable Links:
 * This server uses OSC 8 escape sequences to create clickable links
 * in supported terminal emulators:
 * - iTerm2 (Mac)
 * - Windows Terminal
 * - VS Code integrated terminal
 * - GNOME Terminal 3.26+
 * - Konsole
 * - Hyper
 * 
 * Ctrl+Click (Windows/Linux) or Cmd+Click (Mac) any URL to open.
 * If your terminal doesn't support OSC 8, URLs are still visible
 * and can be copied manually.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 8443;
const HOST = process.env.HOST || '0.0.0.0';

// ANSI color codes
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';

// Check if openssl is available
function hasOpenSSL() {
  const { execSync } = require('child_process');
  try {
    execSync('openssl version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// Generate self-signed certificate if not exists
function generateCert() {
  if (fs.existsSync('cert.pem') && fs.existsSync('key.pem')) {
    return; // Already have certs
  }

  const { execSync } = require('child_process');
  const platform = process.platform;
  
  if (!hasOpenSSL()) {
    console.error('\n❌ OpenSSL not found!');
    console.log('\nTo generate certificates, install OpenSSL:');
    console.log('  Windows:  Download from https://slproweb.com/products/Win32OpenSSL.html');
    console.log('            or install Git for Windows (includes OpenSSL)');
    console.log('  Mac:      brew install openssl');
    console.log('  Linux:    sudo apt-get install openssl  (or equivalent)\n');
    console.log('Alternatively, use one of these options:\n');
    console.log('  1. Use a pre-existing cert/key pair (place cert.pem and key.pem in this folder)');
    console.log('  2. Use mkcert:  npx mkcert create-cert --validity 365');
    console.log('  3. Use ngrok for a public HTTPS URL:  npx ngrok http 8080');
    console.log('  4. Use http-server with auto-generated certs:  npx http-server -S\n');
    process.exit(1);
  }
  
  try {
    console.log('Generating self-signed certificate...');
    
    if (platform === 'win32') {
      // Windows: Use set to handle the null device differently
      execSync('openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost"', { 
        stdio: 'inherit',
        windowsHide: true 
      });
    } else {
      // Unix/Mac
      execSync('openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost" 2>/dev/null', { 
        stdio: 'inherit' 
      });
    }
    
    console.log('✓ Certificates generated: cert.pem, key.pem\n');
  } catch (e) {
    console.error('\n❌ Failed to generate certificate:', e.message);
    console.log('\nTry one of these alternatives:\n');
    console.log('  1. Use mkcert:  npx mkcert create-cert --validity 365');
    console.log('  2. Use ngrok:   npx ngrok http 8080');
    console.log('  3. Place existing cert.pem and key.pem in this folder\n');
    process.exit(1);
  }
}

// Get local IP addresses
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({ name, address: iface.address });
      }
    }
  }
  
  return ips;
}

// MIME types
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4'
};

// Serve file
function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server Error');
      }
      return;
    }
    
    // Add COOP/COEP headers for SharedArrayBuffer (needed for some keepalive techniques)
    const headers = {
      'Content-Type': contentType,
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'max-age=3600'
    };
    
    // Add service worker scope header
    if (ext === '.js' && filePath.includes('sw.js')) {
      headers['Service-Worker-Allowed'] = '/';
    }
    
    res.writeHead(200, headers);
    res.end(data);
  });
}

// Create server
function startServer() {
  generateCert();
  
  const options = {
    key: fs.readFileSync('key.pem'),
    cert: fs.readFileSync('cert.pem')
  };
  
  const server = https.createServer(options, (req, res) => {
    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
    
    // Security: prevent directory traversal
    filePath = path.resolve(filePath);
    if (!filePath.startsWith(__dirname)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }
    
    // Check if file exists, fallback to index.html for SPA routes
    fs.access(filePath, fs.constants.F_OK, (err) => {
      if (err) {
        // Serve index.html for SPA routes
        serveFile(path.join(__dirname, 'index.html'), res);
      } else {
        serveFile(filePath, res);
      }
    });
  });
  
  server.listen(PORT, HOST, () => {
    const ips = getLocalIPs();
    
    console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════════════════════════╗${RESET}`);
    console.log(`${BOLD}${CYAN}║${RESET}     🔷 Pulsetto Web App Server - HTTPS Enabled 🔷          ${BOLD}${CYAN}║${RESET}`);
    console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════════════════╝${RESET}\n`);
    
    // Localhost links
    console.log(`${BOLD}📍 Localhost (this computer):${RESET}`);
    console.log(`   ${GREEN}https://127.0.0.1:${PORT}/${RESET}`);
    console.log(`   ${GREEN}https://localhost:${PORT}/${RESET}\n`);
    
    // Network links
    if (ips.length > 0) {
      console.log(`${BOLD}🌐 Network (other devices on same WiFi):${RESET}`);
      for (const { name, address } of ips) {
        const url = `https://${address}:${PORT}/`;
        // OSC 8 hyperlink escape sequence for clickable terminal links
        const clickable = `\x1b]8;;${url}\x1b\\${url}\x1b]8;;\x1b\\`;
        console.log(`   ${GREEN}${clickable}${RESET} ${DIM}(${name})${RESET}`);
      }
    } else {
      console.log(`${YELLOW}⚠️  No network interfaces found${RESET}`);
    }
    
    console.log(`\n${DIM}──────────────────────────────────────────────────────────────${RESET}`);
    console.log(`${BOLD}Notes:${RESET}`);
    console.log(`  • Web Bluetooth requires HTTPS (self-signed cert OK for testing)`);
    console.log(`  • On mobile: Connect to same WiFi, use network IP address`);
    console.log(`  • Accept the certificate warning in browser (self-signed)`);
    console.log(`  • ${YELLOW}Ctrl+Click${RESET} (or Cmd+Click) any URL above to open\n`);
    
    console.log(`${BOLD}Server running...${RESET} Press Ctrl+C to stop.\n`);
  });
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\nShutting down server...');
    server.close(() => {
      process.exit(0);
    });
  });
}

startServer();
;
