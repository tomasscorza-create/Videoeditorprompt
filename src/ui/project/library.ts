import { optional } from '../dom.js';
import type { ProjectStore } from './store.js';
import type { ResourceEntry, ResourceType } from './types.js';

type LibraryType = Extract<ResourceType, 'character' | 'background' | 'voice'>;

export async function initResourceLibrary(store: ProjectStore): Promise<void> {
  const root = optional<HTMLElement>('#resource-list');
  if (!root) return;
  let activeType: LibraryType = 'character';
  let thumbnails = new Map<string, string>();
  try {
    const response = await fetch('/assets/catalog/index.json', { cache: 'no-store' });
    const catalog = await response.json() as { entries?: Array<{ id: string; thumbnail?: string }> };
    thumbnails = new Map((catalog.entries ?? []).flatMap((entry) => entry.thumbnail ? [[entry.id, entry.thumbnail]] : []));
  } catch {
    // La biblioteca conserva etiquetas, tags y licencias sin miniaturas.
  }

  for (const tab of document.querySelectorAll<HTMLButtonElement>('.resource-tab')) {
    tab.addEventListener('click', () => {
      const type = tab.dataset.resourceType as LibraryType;
      activeType = type;
      for (const item of document.querySelectorAll('.resource-tab')) item.classList.toggle('is-active', item === tab);
      render();
    });
  }

  function render(): void {
    root!.replaceChildren(...store.resources(activeType).map(resourceCard));
  }

  function resourceCard(resource: ResourceEntry): HTMLElement {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'resource-card';
    card.title = `Aplicar ${resource.label} a la escena seleccionada`;
    const thumbnail = resource.characterRef ? thumbnails.get(resource.characterRef.entryId) : null;
    if (thumbnail) {
      const image = document.createElement('img');
      image.src = `/${thumbnail}`;
      image.alt = `Miniatura de ${resource.label}`;
      card.append(image);
    } else {
      const preview = document.createElement('span');
      preview.className = 'render-job-icon';
      preview.textContent = resource.type === 'voice' ? '♪' : '▧';
      card.append(preview);
    }
    const name = document.createElement('strong');
    name.textContent = resource.label;
    const tags = document.createElement('span');
    tags.className = 'resource-tags';
    tags.textContent = resource.tags?.join(' · ') || resource.type;
    const license = document.createElement('span');
    license.className = 'resource-license';
    license.textContent = resource.provenance?.license || 'Licencia sin detalle';
    card.append(name, tags, license);
    card.addEventListener('click', () => apply(resource));
    return card;
  }

  function apply(resource: ResourceEntry): void {
    const scene = store.project().scenes.find((item) => item.id === store.selectedSceneId());
    if (!scene) return;
    let error: string | null = null;
    if (resource.type === 'character') {
      const element = scene.elements.find((item) => item.type === 'character');
      if (element) error = store.dispatch({ type: 'set-character-resource', sceneId: scene.id, elementId: element.id, resourceId: resource.id });
    } else if (resource.type === 'background') {
      const presets = resource.capabilities?.cameraPresets;
      const cameraPreset = Array.isArray(presets) && presets.includes(scene.background.cameraPreset)
        ? scene.background.cameraPreset
        : Array.isArray(presets) ? presets[0] : scene.background.cameraPreset;
      error = store.dispatch({ type: 'set-scene-background', sceneId: scene.id, resourceId: resource.id, cameraPreset });
    } else {
      const turn = scene.dialogue[0];
      if (turn) error = store.dispatch({ type: 'set-dialogue-turn', sceneId: scene.id, turnId: turn.id, voiceId: resource.id });
    }
    const status = optional<HTMLElement>('#project-status');
    if (status) {
      status.textContent = error || `${resource.label} aplicado a «${scene.title}».`;
      status.classList.toggle('error', Boolean(error));
      status.classList.toggle('ok', !error);
    }
  }

  render();
}
