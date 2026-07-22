import { copyFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDirectory, parseArguments, projectRoot, resolvePath, resolveTtsRoot, run } from './common.mjs';

const args = parseArguments();
const output = ensureDirectory(resolvePath(args['output-dir'] || 'public/assets/stage1'));
const ttsRoot = resolveTtsRoot(args);
const transparent = 'color=c=black@0.0:s=1080x1920:r=1:d=1,format=rgba';
const jobs = [
  ['background.png', 'color=c=0x13213b:s=1080x1920:r=1:d=1,format=rgb24,drawbox=x=0:y=0:w=1080:h=400:color=0x213b69:t=fill,drawbox=x=70:y=1350:w=940:h=430:color=0x0c1629:t=fill,drawbox=x=90:y=290:w=900:h=8:color=0x4fd1c5:t=fill'],
  ['body.png', `${transparent},drawbox=x=390:y=520:w=300:h=300:color=0xf2c59f:t=fill:replace=1,drawbox=x=330:y=820:w=420:h=600:color=0x3f7bd9:t=fill:replace=1,drawbox=x=210:y=870:w=120:h=480:color=0x2f64ba:t=fill:replace=1,drawbox=x=750:y=870:w=120:h=480:color=0x2f64ba:t=fill:replace=1,drawbox=x=380:y=1420:w=130:h=380:color=0x1c3159:t=fill:replace=1,drawbox=x=570:y=1420:w=130:h=380:color=0x1c3159:t=fill:replace=1`],
  ['eyes_open.png', `${transparent},drawbox=x=445:y=635:w=48:h=24:color=0x172033:t=fill:replace=1,drawbox=x=587:y=635:w=48:h=24:color=0x172033:t=fill:replace=1`],
  ['eyes_closed.png', `${transparent},drawbox=x=440:y=646:w=58:h=8:color=0x172033:t=fill:replace=1,drawbox=x=582:y=646:w=58:h=8:color=0x172033:t=fill:replace=1`],
  ['mouth_closed.png', `${transparent},drawbox=x=493:y=745:w=94:h=10:color=0x8d3e48:t=fill:replace=1`],
  ['mouth_medium.png', `${transparent},drawbox=x=493:y=730:w=94:h=40:color=0x782f3b:t=fill:replace=1,drawbox=x=508:y=742:w=64:h=16:color=0xf28c9a:t=fill:replace=1`],
  ['mouth_open.png', `${transparent},drawbox=x=485:y=710:w=110:h=82:color=0x5a2430:t=fill:replace=1,drawbox=x=505:y=758:w=70:h=22:color=0xf28c9a:t=fill:replace=1`],
];
for (const [name, source] of jobs) run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', source, '-frames:v', '1', path.join(output, name)], { cwd: projectRoot });
copyFileSync(path.join(ttsRoot, 'fonts', 'arial.ttf'), path.join(output, 'arial.ttf'));
console.log(JSON.stringify({ generated: jobs.length + 1, output: path.relative(projectRoot, output) }));
