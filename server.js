const express = require('express');
const { spawn } = require('child_process');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(__dirname));

// Platform‑specific yt‑dlp executable name
let ytDlpExecutable = 'yt-dlp.exe';   // Windows default
if (process.platform === 'linux') {
  ytDlpExecutable = 'yt-dlp';         // Linux (no extension)
}
const ytDlpPath = path.join(__dirname, ytDlpExecutable);

// Check if the executable exists
if (!fs.existsSync(ytDlpPath)) {
  console.error(`ERROR: ${ytDlpExecutable} not found at:`, ytDlpPath);
  if (process.platform === 'linux') {
    console.error('Make sure the Linux binary is named exactly "yt-dlp" and is executable (chmod +x yt-dlp)');
  } else {
    console.error('Please download yt-dlp.exe from: https://github.com/yt-dlp/yt-dlp/releases');
  }
  process.exit(1);
}

// Path to cookies file
const cookiesPath = path.join(__dirname, 'cookies.txt');

// ------------------- API /info -------------------
app.get('/api/info', async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) return res.status(400).json({ error: 'Missing URL' });

  const args = [
    '--cookies', cookiesPath,
    '--dump-json',
    '--no-warnings',
    videoUrl
  ];

  const ytdl = spawn(ytDlpPath, args);

  let output = '';
  let errorOutput = '';

  ytdl.stdout.on('data', (data) => { output += data.toString(); });
  ytdl.stderr.on('data', (data) => { errorOutput += data.toString(); });

  ytdl.on('close', (code) => {
    if (code !== 0) {
      console.error('yt-dlp error:', errorOutput);
      return res.status(500).json({ error: 'Failed to fetch video info: ' + errorOutput });
    }

    try {
      const videoInfo = JSON.parse(output);
      const formats = videoInfo.formats
        .filter(f => f.ext === 'mp4' || f.ext === 'webm')
        .map(f => ({
          itag: f.format_id,
          qualityLabel: f.format_note || (f.height ? `${f.height}p` : f.quality),
          container: f.ext,
          contentLength: f.filesize,
          hasVideo: f.vcodec !== 'none',
          hasAudio: f.acodec !== 'none'
        }));

      res.json({ title: videoInfo.title, formats });
    } catch (err) {
      res.status(500).json({ error: 'Failed to parse video info' });
    }
  });
});

// ------------------- API /download -------------------
app.get('/download', async (req, res) => {
  const videoUrl = req.query.url;
  const itag = req.query.itag;
  if (!videoUrl || !itag) return res.status(400).send('Missing parameters');

  try {
    // First get the video title (using cookies)
    const titleProcess = spawn(ytDlpPath, [
      '--cookies', cookiesPath,
      '--get-title',
      videoUrl
    ]);
    let title = 'video';

    titleProcess.stdout.on('data', (data) => {
      title = data.toString().trim().replace(/[^\w\s]/gi, '');
    });

    titleProcess.on('close', () => {
      // Stream the video (no forced client, no custom UA)
      const stream = spawn(ytDlpPath, [
        '--cookies', cookiesPath,
        '-f', itag,
        '-o', '-',
        videoUrl
      ]);

      res.header('Content-Disposition', `attachment; filename="${title}.mp4"`);
      res.header('Content-Type', 'video/mp4');
      stream.stdout.pipe(res);

      stream.stderr.on('data', (data) => console.error('Download error:', data.toString()));
      stream.on('error', (err) => { if (!res.headersSent) res.status(500).send('Download error'); });
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error processing download');
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Using yt-dlp at: ${ytDlpPath}`);
});
