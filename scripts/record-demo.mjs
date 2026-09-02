// Records the extension in a real VS Code window and encodes the result as media/demo.gif.
//
//   npm run demo                 capture the frames, then encode
//   npm run demo -- --encode     re-encode the frames already captured (fast iteration)
//   npm run demo -- --width 800 --fps 10 --colors 128
//
// Capture happens in tests/extension/demo.test.ts (Chromium DevTools Protocol screenshots of the
// editor area); this script only orchestrates it and drives ffmpeg.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const frameDir = path.join(root, '.vscode-test', 'demo');
const output = path.join(root, flag('out', 'media/demo.gif'));
const width = Number(flag('width', '900'));
const fps = Number(flag('fps', '12'));
const colors = Number(flag('colors', '192'));
const stillWidth = Number(flag('still-width', '1232'));

function run(command, commandArgs, env = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(' ')} exited with ${String(result.status)}`);
  }
}

function requireFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    throw new Error('ffmpeg is required to encode the GIF (apt install ffmpeg)');
  }
}

if (!args.includes('--encode')) {
  console.log('> capturing frames in a real VS Code window…');
  run('node', ['esbuild.mjs', '--tests']);
  run('node', ['scripts/prepare-extension-fixtures.mjs']);
  run('npx', ['vscode-test'], { FTM_DEMO: '1' });
}

const manifestPath = path.join(frameDir, 'frames.json');
if (!existsSync(manifestPath)) {
  throw new Error(`no frames found at ${manifestPath}; run without --encode first`);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

// concat demuxer: per-frame durations give each storyboard beat its own hold time. The last entry
// has to be repeated because the demuxer ignores the duration of the final file.
const listPath = path.join(frameDir, 'frames.txt');
const lines = manifest.frames.flatMap((frame) => [
  `file '${frame.file}'`,
  `duration ${frame.hold}`,
]);
lines.push(`file '${manifest.frames[manifest.frames.length - 1].file}'`);
writeFileSync(listPath, `${lines.join('\n')}\n`);

requireFfmpeg();
console.log(`> encoding ${manifest.frames.length} frames → ${path.relative(root, output)}`);
run('ffmpeg', [
  '-y',
  '-loglevel',
  'error',
  '-f',
  'concat',
  '-safe',
  '0',
  '-i',
  listPath,
  '-vf',
  `fps=${fps},scale=${width}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
  '-loop',
  '0',
  output,
]);

// One still per storyboard beat (the frame it rests on): usable in the README next to the GIF.
const stillDir = path.join(root, flag('stills', 'media/screenshots'));
mkdirSync(stillDir, { recursive: true });
const restFrame = new Map();
for (const frame of manifest.frames) {
  const best = restFrame.get(frame.beat);
  if (!best || frame.hold > best.hold) {
    restFrame.set(frame.beat, frame);
  }
}
for (const [beat, frame] of restFrame) {
  run('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    path.join(frameDir, frame.file),
    '-vf',
    `scale=${stillWidth}:-2:flags=lanczos`,
    path.join(stillDir, `${beat}.png`),
  ]);
}
console.log(`> ${restFrame.size} stills → ${path.relative(root, stillDir)}/`);

const bytes = statSync(output).size;
const seconds = manifest.frames.reduce((sum, frame) => sum + frame.hold, 0);
console.log(
  `> ${path.relative(root, output)}: ${(bytes / 1024 / 1024).toFixed(2)} MB, ${seconds.toFixed(1)}s, ${width}px wide @ ${fps}fps`,
);
if (bytes > 6 * 1024 * 1024) {
  console.warn('> larger than 6 MB; consider --width 800 --fps 10 --colors 128');
}
