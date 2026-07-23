import type { PreviewJob } from '../preview/types.js';
import { optional } from './dom.js';

const CARD_GAP_PX = 8;
const FALLBACK_CARD_WIDTH_PX = 104;

// Muestra TRABAJOS publicados (por jobId), no escenas del proyecto de autoría.
// Las escenas editables llegan en el Hito 3 desde shared/project-editor.js.
export function renderJobGallery(jobs: PreviewJob[], selectedJobId: string): void {
  const gallery = optional<HTMLElement>('#scene-gallery');
  if (!gallery) return;
  gallery.replaceChildren(...jobs.map((job) => createJobCard(job, job.jobId === selectedJobId)));
  wireScrollArrows(gallery);
}

function createJobCard(job: PreviewJob, selected: boolean): HTMLButtonElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'scene-card';
  card.dataset.job = job.jobId;
  card.setAttribute('role', 'option');
  card.setAttribute('aria-selected', String(selected));
  if (selected) card.classList.add('is-selected');

  const thumb = document.createElement('span');
  thumb.className = 'scene-thumb';
  if (job.videoPath) {
    const video = document.createElement('video');
    video.src = `/generated/${job.videoPath}#t=0.1`;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    thumb.appendChild(video);
  } else {
    thumb.classList.add('scene-thumb-empty');
    thumb.textContent = 'Sin video';
  }

  const name = document.createElement('span');
  name.className = 'scene-name';
  name.textContent = job.jobId;
  name.title = `Trabajo ${job.jobId}`;

  const badges = document.createElement('span');
  badges.className = 'scene-badges';
  const parts: string[] = [];
  if (Number.isFinite(job.durationSeconds) && job.durationSeconds > 0) parts.push(`${job.durationSeconds.toFixed(1)}s`);
  if (job.deterministic === true) parts.push('✓');
  badges.textContent = parts.join(' · ');

  card.append(thumb, name, badges);
  if (!selected) {
    card.addEventListener('click', () => {
      const url = new URL(window.location.href);
      url.searchParams.set('job', job.jobId);
      window.location.assign(url);
    });
  }
  return card;
}

// Desplazamiento circular: se recicla el elemento del extremo y se compensa el salto.
function wireScrollArrows(gallery: HTMLElement): void {
  const left = optional<HTMLButtonElement>('#scroll-left');
  const right = optional<HTMLButtonElement>('#scroll-right');
  if (!left || !right || left.dataset.wired === 'true') return;
  left.dataset.wired = 'true';

  const stepWidth = (): number => {
    const first = gallery.firstElementChild as HTMLElement | null;
    return (first?.offsetWidth || FALLBACK_CARD_WIDTH_PX) + CARD_GAP_PX;
  };

  left.addEventListener('click', () => {
    if (gallery.children.length < 2 || !gallery.lastElementChild) return;
    const step = stepWidth();
    gallery.insertBefore(gallery.lastElementChild, gallery.firstElementChild);
    gallery.scrollLeft += step;
    gallery.scrollBy({ left: -step, behavior: 'smooth' });
  });

  right.addEventListener('click', () => {
    if (gallery.children.length < 2 || !gallery.firstElementChild) return;
    const step = stepWidth();
    gallery.appendChild(gallery.firstElementChild);
    gallery.scrollLeft -= step;
    gallery.scrollBy({ left: step, behavior: 'smooth' });
  });
}
