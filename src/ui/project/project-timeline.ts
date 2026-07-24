import { optional } from '../dom.js';
import type { ProjectStore } from './store.js';

export function initProjectTimeline(store: ProjectStore): void {
  const root = optional<HTMLElement>('#project-timeline-content');
  const summary = optional<HTMLElement>('#timeline-summary');
  if (!root) return;

  const render = (): void => {
    const project = store.project();
    const wordTotal = project.scenes.reduce((total, scene) => total + scene.dialogue.reduce((sum, turn) => sum + words(turn.text), 0), 0);
    if (summary) summary.textContent = `${project.scenes.length} escena(s) · ${wordTotal} palabras · tiempos pendientes de FFprobe`;

    const sceneRow = row('Escenas');
    const turnRow = row('Diálogo');
    const sceneTrack = sceneRow.lastElementChild as HTMLElement;
    const turnTrack = turnRow.lastElementChild as HTMLElement;
    for (const scene of project.scenes) {
      const sceneWords = scene.dialogue.reduce((sum, turn) => sum + words(turn.text), 0);
      const sceneNode = document.createElement('button');
      sceneNode.type = 'button';
      sceneNode.className = 'timeline-scene';
      sceneNode.classList.toggle('is-selected', scene.id === store.selectedSceneId());
      sceneNode.style.width = `${Math.max(7, sceneWords * .25)}rem`;
      sceneNode.innerHTML = `<strong></strong><span></span>`;
      (sceneNode.firstElementChild as HTMLElement).textContent = scene.title;
      (sceneNode.lastElementChild as HTMLElement).textContent = `${scene.dialogue.length} turnos · ${sceneWords} palabras`;
      sceneNode.addEventListener('click', () => store.dispatch({ type: 'select-scene', sceneId: scene.id }));
      sceneTrack.append(sceneNode);

      for (const turn of scene.dialogue) {
        const turnNode = document.createElement('div');
        turnNode.className = 'timeline-turn';
        turnNode.style.width = `${Math.max(6, words(turn.text) * .25)}rem`;
        const speaker = scene.elements.find((item) => item.id === turn.speakerElementId)?.resourceId || turn.speakerElementId;
        const title = document.createElement('strong');
        title.textContent = speaker;
        const copy = document.createElement('span');
        copy.textContent = turn.text;
        turnNode.append(title, copy);
        turnTrack.append(turnNode);
      }
    }
    root.replaceChildren(sceneRow, turnRow);
  };

  store.subscribe(render);
  render();
}

function row(label: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'timeline-row';
  const heading = document.createElement('span');
  heading.className = 'timeline-track-label';
  heading.textContent = label;
  const track = document.createElement('div');
  track.className = label === 'Escenas' ? 'timeline-scenes' : 'timeline-turns';
  row.append(heading, track);
  return row;
}

function words(value: string): number {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}
