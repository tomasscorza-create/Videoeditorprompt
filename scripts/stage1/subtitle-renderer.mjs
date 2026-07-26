import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDirectory, run, sha256 } from './common.mjs';

export function renderSubtitle(context, video, text, style, fontPath) {
  const subtitleKey = sha256(JSON.stringify({ text, fontSize: style.fontSize, bottomMargin: style.bottomMargin }));
  const subtitleRelative = path.posix.join('subtitle', `${subtitleKey}.png`);
  const subtitlePng = path.join(context.generatedRoot, ...subtitleRelative.split('/'));
  ensureDirectory(path.dirname(subtitlePng));
  const subtitleTempRoot = ensureDirectory(path.join(context.tempRoot, 'subtitle', subtitleKey));
  const subtitleText = path.join(subtitleTempRoot, 'subtitle.txt');
  writeFileSync(subtitleText, text, 'utf8');
  const ffmpegPath = (value) => value.replaceAll('\\', '/').replace(':', '\\:');
  const boxHeight = 250;
  const y = video.height - style.bottomMargin - boxHeight;
  const filter = [
    `[0:v][1:v]overlay=x=70:y=${y}:format=auto[boxed]`,
    `[boxed]drawtext=fontfile='${ffmpegPath(fontPath)}':textfile='${ffmpegPath(subtitleText)}':fontcolor=white:fontsize=${style.fontSize}:line_spacing=16:x=(w-text_w)/2:y=${y + 52}[out]`,
  ].join(';');
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', `color=c=black@0.0:s=${video.width}x${video.height}:r=1:d=1,format=rgba`,
    '-f', 'lavfi',
    '-i', `color=c=black@0.72:s=${video.width - 140}x${boxHeight}:r=1:d=1,format=rgba`,
    '-filter_complex', filter, '-map', '[out]', '-frames:v', '1', subtitlePng,
  ], { stage: 'preparing', errorCode: 'FFMPEG_SUBTITLE_EXIT_NONZERO' });
  return { subtitleKey, subtitleRelative, subtitlePng };
}

export function wrapSubtitleText(text, maxCharactersPerLine = 38) {
  const words = text.trim().split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && candidate.length > maxCharactersPerLine) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.join('\n');
}
