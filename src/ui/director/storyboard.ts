import { selectProjectItem } from '../project/selection.js';
import type { ProjectStore } from '../project/store.js';
import type { ResourceEntry, SceneView } from '../project/types.js';
import { showRightPanelPage } from '../right-panel.js';

export function renderDirectorStoryboard(root: HTMLElement, store: ProjectStore): void {
  const project = store.project();
  const selected = store.selectedSceneId();
  const resources = resourceLabels(store);
  root.replaceChildren(...project.scenes.map((scene, index) => sceneCard(scene, index, selected, resources)));
}

function sceneCard(scene: SceneView, index: number, selected: string, resources: Map<string, string>): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'director-scene-card';
  button.classList.toggle('is-selected', scene.id === selected);
  button.setAttribute('aria-pressed', String(scene.id === selected));
  const number = document.createElement('span');
  number.className = 'director-scene-number';
  number.textContent = String(index + 1).padStart(2, '0');
  const copy = document.createElement('span');
  copy.className = 'director-scene-copy';
  const title = document.createElement('strong');
  title.textContent = scene.title || `Escena ${index + 1}`;
  const meta = document.createElement('span');
  meta.textContent = describeScene(scene, resources);
  const summary = document.createElement('small');
  summary.textContent = scene.dialogue[0]?.text?.trim() || 'Composición visual sin diálogo.';
  copy.append(title, meta, summary);
  const arrow = document.createElement('span');
  arrow.className = 'director-scene-arrow';
  arrow.textContent = '›';
  button.append(number, copy, arrow);
  button.addEventListener('click', () => {
    selectProjectItem({ kind: 'scene', sceneId: scene.id });
    showRightPanelPage('editing');
  });
  return button;
}

function describeScene(scene: SceneView, resources: Map<string, string>): string {
  const characterCount = scene.elements.filter((element) => element.type === 'character').length;
  const props = scene.elements
    .filter((element) => element.type === 'prop' || element.type === 'template' || element.type === 'image')
    .map((element) => resources.get(element.resourceId ?? element.templateId ?? '') ?? element.type);
  const voiceover = scene.dialogue.some((turn) => turn.speakerType === 'voiceover');
  const mode = voiceover ? 'Narración' : characterCount >= 2 ? 'Diálogo' : characterCount === 1 ? 'Un personaje' : 'Visual';
  return [mode, characterCount > 0 ? `${characterCount} personaje${characterCount === 1 ? '' : 's'}` : null, props[0] ?? null]
    .filter(Boolean)
    .join(' · ');
}

function resourceLabels(store: ProjectStore): Map<string, string> {
  const entries: ResourceEntry[] = ['character', 'prop', 'template', 'image', 'background']
    .flatMap((type) => store.resources(type as ResourceEntry['type']));
  return new Map(entries.map((entry) => [entry.id, entry.label]));
}
