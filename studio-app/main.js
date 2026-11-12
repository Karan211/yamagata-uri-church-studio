const { app, BrowserWindow, Menu, shell, session, systemPreferences, desktopCapturer } = require('electron');
const { execFile, spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'app');
const PORT = 47815; // 고정 포트 — Chrome 의 마이크 허용이 주소별로 기억되므로 바꾸지 않는다
const HOME = '/' + encodeURIComponent('야마가타우리교회 스튜디오.html');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
let origin = '';
// ffmpeg 찾기: 앱 옆에 넣어 둔 것 → 흔한 설치 위치 → PATH 순서 (맥 · 윈도우 공통)
const FF = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const FFMPEG = [path.join(process.resourcesPath || '', FF), path.join(path.dirname(process.execPath), FF),
  '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg', 'C:\\ffmpeg\\bin\\ffmpeg.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', FF),
  ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(d => path.join(d, FF))].find(f => { try { return fs.statSync(f).isFile(); } catch (e) { return false; } }) || '';
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

/* ───── 「방송」 화면이 쓰는 기능: 녹화 저장 · 실시간 송출 · 통역 자막 전달 ───── */
const recs = new Map(); let recSeq = 0, live = null;
const bus = {}, listeners = {};
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const pad = n => String(n).padStart(2, '0');
const stamp = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`; };
function readBody(req, limit) { return new Promise((ok, no) => { const a = []; let n = 0; req.on('data', c => { n += c.length; if (n > limit) { no(new Error('too large')); req.destroy(); } else a.push(c); }); req.on('end', () => ok(Buffer.concat(a).toString('utf8'))); req.on('error', no); }); }
function pipeBody(req, dst) { return new Promise((ok, no) => { req.on('data', c => { if (!dst.write(c)) { req.pause(); dst.once('drain', () => req.resume()); } }); req.on('end', ok); req.on('error', no); dst.once('error', no); }); }
function stopLive() { const l = live; if (!l) return; live = null; try { l.p.stdin.end(); } catch (e) {} setTimeout(() => { try { l.p.kill('SIGKILL'); } catch (e) {} }, 4000); }

async function api(req, res, u) {
  // 이 컴퓨터의 이 앱 화면에서 온 요청만 받는다 (다른 웹사이트가 몰래 부르지 못하게)
  if (req.headers.host !== origin.slice(7)) return json(res, 403, { error: 'forbidden' });
  if (req.method === 'POST' && req.headers.origin !== origin) return json(res, 403, { error: 'forbidden' });
  const p = u.pathname, q = u.searchParams, POST = req.method === 'POST';
  try {
    if (p === '/api/ping') return json(res, 200, { app: true, ffmpeg: !!FFMPEG });

    if (p.startsWith('/api/bus/')) {
      const ch = p.slice(9); if (!/^[a-z]{1,12}$/.test(ch)) return json(res, 400, {});
      if (POST) { bus[ch] = await readBody(req, 200000); (listeners[ch] || []).forEach(r => r.write('data: ' + bus[ch].replace(/\n/g, ' ') + '\n\n')); return json(res, 200, {}); }
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('retry: 2000\n\n'); if (bus[ch]) res.write('data: ' + bus[ch].replace(/\n/g, ' ') + '\n\n');
      (listeners[ch] = listeners[ch] || []).push(res);
      req.on('close', () => { listeners[ch] = listeners[ch].filter(r => r !== res); });
      return;
    }

    if (p === '/api/rec/start' && POST) {
      const ext = q.get('ext') === 'mp4' ? 'mp4' : 'webm', id = ++recSeq, dir = app.getPath('videos'), base = path.join(dir, '예배 녹화 ' + stamp());
      fs.mkdirSync(dir, { recursive: true });
      const r = { ext, h264: q.get('h264') === '1', base, raw: base + '.녹화중.' + ext }; r.ws = fs.createWriteStream(r.raw); recs.set(id, r);
      return json(res, 200, { id });
    }
    if (p === '/api/rec/chunk' && POST) { const r = recs.get(+q.get('id')); if (!r) return json(res, 404, { error: '녹화를 찾을 수 없습니다' }); await pipeBody(req, r.ws); return json(res, 200, {}); }
    if (p === '/api/rec/stop' && POST) {
      const id = +q.get('id'), r = recs.get(id); if (!r) return json(res, 404, { error: '녹화를 찾을 수 없습니다' }); recs.delete(id);
      await new Promise(ok => r.ws.end(ok));
      const plain = r.base + '.' + r.ext, mp4 = r.base + '.mp4';
      // 어디서나 열리는 보통 MP4 로 다시 싼다. 실패하면 받은 그대로 둔다.
      if (FFMPEG && r.h264) {
        const okRemux = await new Promise(ok => execFile(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i', r.raw, '-c:v', 'copy', ...(r.ext === 'mp4' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k']), '-movflags', '+faststart', mp4 + '.tmp.mp4'], { timeout: 600000 }, err => ok(!err)));
        if (okRemux) { fs.renameSync(mp4 + '.tmp.mp4', mp4); fs.unlinkSync(r.raw); return json(res, 200, { path: mp4 }); }
        try { fs.unlinkSync(mp4 + '.tmp.mp4'); } catch (e) {}
      }
      fs.renameSync(r.raw, plain); return json(res, 200, { path: plain });
    }

    if (p === '/api/stream/start' && POST) {
      if (!FFMPEG) return json(res, 501, { error: 'ffmpeg 가 설치되어 있지 않습니다' });
      if (live) return json(res, 409, { error: '이미 송출 중입니다' });
      const o = JSON.parse(await readBody(req, 4000)), url = String(o.url || ''), key = String(o.key || '');
      if (!/^rtmps?:\/\/[^\s]+$/.test(url) || !/^[^\s\/]+$/.test(key)) return json(res, 400, { error: '서버 주소나 스트림 키가 올바르지 않습니다' });
      const fps = [24, 30, 60].includes(+o.fps) ? +o.fps : 30, vbit = Math.max(1000, Math.min(12000, +o.vbit || 4500));
      const enc = process.platform === 'darwin' ? ['-c:v', 'h264_videotoolbox', '-realtime', '1', '-profile:v', 'high'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency'];
      const p2 = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'info', '-stats_period', '1', '-fflags', '+genpts', '-i', 'pipe:0', ...enc, '-b:v', vbit + 'k', '-maxrate', vbit + 'k', '-bufsize', vbit * 2 + 'k', '-g', String(fps * 2), '-r', String(fps), '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2', '-f', 'flv', url.replace(/\/+$/, '') + '/' + key], { stdio: ['pipe', 'ignore', 'pipe'] });
      const l = live = { p: p2, log: '', stat: '', running: true };
      p2.stdin.on('error', () => {});
      p2.stderr.on('data', d => { const t = d.toString().split(key).join('****'); const m = /fps=\s*([\d.]+).*?bitrate=\s*([\d.]+)kbits/.exec(t); if (m) l.stat = Math.round(+m[2]) + 'kbps'; else l.log = (l.log + t).slice(-600); });
      p2.on('error', e => { l.running = false; l.log += ' ' + e.message; });
      p2.on('exit', () => { l.running = false; });
      return json(res, 200, {});
    }
    if (p === '/api/stream/chunk' && POST) { if (!live || !live.running) return json(res, 409, { error: '송출이 끊겼습니다' }); await pipeBody(req, live.p.stdin); return json(res, 200, {}); }
    if (p === '/api/stream/status') { const l = live; return json(res, 200, l ? { running: l.running, stat: l.stat, log: l.log.trim().split('\n').slice(-3).join(' ') } : { running: false, stat: '', log: '' }); }
    if (p === '/api/stream/stop' && POST) { stopLive(); return json(res, 200, {}); }
    json(res, 404, { error: 'not found' });
  } catch (e) { if (!res.headersSent) json(res, 500, { error: e.message }); }
}

// 앱 안의 화면을 이 컴퓨터 안에서만(127.0.0.1) 제공한다. 동시통역 화면은 같은 주소를 Chrome 에서 연다.
function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let p;
      try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end(); }
      if (p.startsWith('/api/')) return api(req, res, new URL(req.url, 'http://x'));
      if (p === '/') p = decodeURIComponent(HOME);
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(data);
      });
    });
    server.once('error', () => server.listen(0, '127.0.0.1'));
    server.on('listening', () => resolve(server.address().port));
    server.listen(PORT, '127.0.0.1');
  });
}

function openInChrome(url) {
  const fallback = err => { if (err) shell.openExternal(url); };
  if (process.platform === 'darwin') execFile('open', ['-a', 'Google Chrome', url], fallback);
  else if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', 'chrome', url], { windowsHide: true }, fallback);
  else execFile('google-chrome', [url], fallback);
}

function wire(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(origin)) {
      if (url.includes('interpret.html')) { openInChrome(url); return { action: 'deny' }; }
      // 자막 송출 창
      return { action: 'allow', overrideBrowserWindowOptions: { width: 1280, height: 720, backgroundColor: '#000000', autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } } };
    }
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) { e.preventDefault(); return; }
    if (url.includes('interpret.html')) { e.preventDefault(); openInChrome(url); }
  });
  win.webContents.on('did-create-window', child => wire(child));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1000, minHeight: 640,
    backgroundColor: '#0e1420',
    title: '야마가타우리교회 스튜디오',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  wire(win);
  win.loadURL(origin + HOME);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.whenReady().then(async () => {
    origin = 'http://127.0.0.1:' + (await serve());
    // 카메라 · 마이크 · 화면 공유 · 전체 화면만 허용
    session.defaultSession.setPermissionRequestHandler(async (wc, permission, cb, details) => {
      if (!wc.getURL().startsWith(origin)) return cb(false);
      if (permission === 'media') {
        if (process.platform !== 'darwin') return cb(true);
        try { let ok = true; for (const t of (details && details.mediaTypes) || ['video']) ok = (await systemPreferences.askForMediaAccess(t === 'audio' ? 'microphone' : 'camera')) && ok; return cb(ok); } catch (e) { return cb(false); }
      }
      cb(permission === 'fullscreen' || permission === 'display-capture');
    });
    session.defaultSession.setPermissionCheckHandler((wc, permission, requestingOrigin) => requestingOrigin.startsWith(origin) && ['media', 'fullscreen', 'display-capture'].includes(permission));
    // 화면 공유: macOS 의 고르기 창을 쓰고, 없으면 첫 번째 화면
    session.defaultSession.setDisplayMediaRequestHandler((request, cb) => {
      desktopCapturer.getSources({ types: ['screen'] }).then(src => cb(src.length ? { video: src[0] } : {})).catch(() => cb({}));
    }, { useSystemPicker: true });
    // 저장할 때 기본 위치를 「동영상」/「그림」 폴더로
    session.defaultSession.on('will-download', (_e, item) => {
      const name = item.getFilename();
      item.setSaveDialogOptions({ title: '저장', defaultPath: path.join(app.getPath(/\.png$/i.test(name) ? 'pictures' : 'videos'), name) });
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: app.name, submenu: [{ role: 'about', label: '야마가타우리교회 스튜디오에 관하여' }, { type: 'separator' }, { role: 'hide', label: '가리기' }, { role: 'quit', label: '종료' }] },
      { label: '편집', submenu: [{ role: 'undo', label: '실행 취소' }, { role: 'redo', label: '다시 실행' }, { type: 'separator' }, { role: 'cut', label: '오려두기' }, { role: 'copy', label: '복사' }, { role: 'paste', label: '붙여넣기' }, { role: 'selectAll', label: '모두 선택' }] },
      { label: '보기', submenu: [{ role: 'reload', label: '새로 고침' }, { role: 'togglefullscreen', label: '전체 화면' }] },
      { label: '윈도우', submenu: [{ role: 'minimize', label: '최소화' }, { role: 'close', label: '닫기' }] }
    ]));
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { stopLive(); recs.forEach(r => { try { r.ws.end(); } catch (e) {} }); });
}
