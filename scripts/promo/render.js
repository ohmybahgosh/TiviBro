/* Renders the TiviBro promo (promo.html) frame by frame to /tmp/promo/video.mp4.
   Put beside promo.html: fonts/ (Space Grotesk as sg.woff2, JetBrains Mono as jbm.woff2), img/ (the
   shots from scripts/demo/promo-shots.js and tests/soak/my-teams.js --shots, the phone app's screenshots,
   icon-512.png and wordmark.png from site/img) and clips/ (site/media/guide.mp4 and live-edit.mp4 as WebM).
     node render.js            the whole video
     node render.js 3,16,45    single frames to /tmp/promo/f/ for a look
   Then mux the music and the cover picture with ffmpeg (-disposition:v:1 attached_pic). */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const FPS = 30;
const only = process.argv[2] ? process.argv[2].split(',').map(Number) : null;
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('file://' + path.join(__dirname, 'promo.html'));
  await page.evaluate(() => window.ready);
  if (only) {
    for (const t of only) { await page.evaluate((t) => window.seek(t), t); await page.screenshot({ path: `/tmp/promo/f/t${t}.jpg`, type: 'jpeg', quality: 80 }); }
    await b.close(); return;
  }
  const D = await page.evaluate(() => window.DURATION);
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '/tmp/promo/video.mp4'], { stdio: ['pipe', 'inherit', 'inherit'] });
  const n = Math.round(D * FPS);
  for (let i = 0; i < n; i++) {
    await page.evaluate((t) => window.seek(t), i / FPS);
    const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 150 === 0) console.log('frame', i, '/', n);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  await b.close(); console.log('done');
})();
