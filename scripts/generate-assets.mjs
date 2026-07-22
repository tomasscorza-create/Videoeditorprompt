import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { run } from './process.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'assets');
mkdirSync(assets, { recursive: true });

const jobs = [
  {
    output: path.join(assets, 'background.png'),
    args: [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi',
      '-i', 'color=c=0x14213d:s=1080x1920:r=1:d=1,format=rgb24,drawbox=x=0:y=0:w=1080:h=320:color=0x1f3b73:t=fill,drawbox=x=80:y=420:w=920:h=8:color=0x6ee7f9:t=fill,drawbox=x=80:y=1560:w=920:h=280:color=0x0b1224:t=fill',
      '-frames:v', '1',
    ],
  },
  {
    output: path.join(assets, 'character_body.png'),
    args: [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi',
      '-i', 'color=c=black@0.0:s=360x900:r=1:d=1,format=rgba,drawbox=x=90:y=40:w=180:h=180:color=0xffd6a5:t=fill:replace=1,drawbox=x=65:y=220:w=230:h=370:color=0x5b8def:t=fill:replace=1,drawbox=x=0:y=260:w=65:h=300:color=0x3f6fc7:t=fill:replace=1,drawbox=x=295:y=260:w=65:h=300:color=0x3f6fc7:t=fill:replace=1,drawbox=x=85:y=590:w=80:h=310:color=0x243b6b:t=fill:replace=1,drawbox=x=195:y=590:w=80:h=310:color=0x243b6b:t=fill:replace=1',
      '-frames:v', '1',
    ],
  },
  {
    output: path.join(assets, 'character_overlay.png'),
    args: [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi',
      '-i', 'color=c=black@0.0:s=360x900:r=1:d=1,format=rgba,drawbox=x=125:y=105:w=35:h=18:color=0x172033:t=fill:replace=1,drawbox=x=200:y=105:w=35:h=18:color=0x172033:t=fill:replace=1,drawbox=x=145:y=165:w=70:h=14:color=0xb65353:t=fill:replace=1,drawbox=x=225:y=310:w=48:h=48:color=0x6ee7f9:t=fill:replace=1',
      '-frames:v', '1',
    ],
  },
];

for (const job of jobs) {
  run('ffmpeg', [...job.args, job.output], { cwd: root });
  console.log(`Generado: ${path.relative(root, job.output)}`);
}

const wavOutput = path.join(assets, 'test.wav');
run('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi',
  '-i', 'sine=frequency=523.25:sample_rate=48000:duration=3',
  '-filter:a', 'volume=0.12',
  '-c:a', 'pcm_s16le',
  wavOutput,
], { cwd: root });
console.log(`Generado: ${path.relative(root, wavOutput)}`);
