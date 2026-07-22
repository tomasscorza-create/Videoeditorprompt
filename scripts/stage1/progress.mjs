import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDirectory, writeJson } from './common.mjs';
export { serializeError } from './errors.mjs';

export const JOB_STATES = ['preparing', 'generating_voice', 'analyzing_audio', 'rendering_frames', 'encoding', 'completed', 'failed'];

export function createProgressReporter(context) {
  const eventsFile = path.join(context.statusRoot, 'progress.jsonl');
  const statusFile = path.join(context.statusRoot, 'job-status.json');
  ensureDirectory(context.statusRoot);
  return (state, details = {}) => {
    if (!JOB_STATES.includes(state)) throw new Error(`Estado de trabajo desconocido: ${state}`);
    const event = { version: 1, jobId: context.jobId, state, timestamp: new Date().toISOString(), ...details };
    appendFileSync(eventsFile, `${JSON.stringify(event)}\n`, 'utf8');
    writeJson(statusFile, event);
    process.stdout.write(`${JSON.stringify(event)}\n`);
    return event;
  };
}
