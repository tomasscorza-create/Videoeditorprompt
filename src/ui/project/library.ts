import { optional } from '../dom.js';
import { importBackgroundResource } from '../director/api.js';
import type { ProjectStore } from './store.js';
import type { ResourceEntry, ResourceType } from './types.js';

type LibraryType = Extract<ResourceType, 'character' | 'background' | 'voice'>;
const ACTIVE_LIBRARY_TAB_KEY = 'local-video.library-active-tab';

export async function initResourceLibrary(store: ProjectStore): Promise<void> {
  const root = optional<HTMLElement>('#resource-list');
  if (!root) return;
  const registerButton = optional<HTMLButtonElement>('#resource-register');
  const registerFile = optional<HTMLInputElement>('#resource-register-file');
  const libraryStatus = optional<HTMLElement>('#resource-library-status');
  let activeType: LibraryType = sessionStorage.getItem(ACTIVE_LIBRARY_TAB_KEY) === 'background' ? 'background' : 'character';
  let thumbnails = new Map<string, string>();
  try {
    const response = await fetch('/assets/catalog/index.json', { cache: 'no-store' });
    const catalog = await response.json() as { entries?: Array<{ id: string; thumbnail?: string }> };
    thumbnails = new Map((catalog.entries ?? []).flatMap((entry) => entry.thumbnail ? [[entry.id, entry.thumbnail]] : []));
  } catch {
    // La biblioteca conserva etiquetas, tags y licencias sin miniaturas.
  }
  await Promise.all(store.resources('background').map(async (resource) => {
    if (!resource.backgroundManifest) return;
    try {
      const response = await fetch(`/${resource.backgroundManifest}`, { cache: 'no-store' });
      if (!response.ok) return;
      const manifest = await response.json() as { layers?: { far?: string } };
      if (!manifest.layers?.far) return;
      const base = resource.backgroundManifest.slice(0, resource.backgroundManifest.lastIndexOf('/') + 1);
      thumbnails.set(resource.id, `${base}${manifest.layers.far}`);
    } catch {
      // El recurso sigue disponible aunque su miniatura no pueda cargarse.
    }
  }));

  for (const tab of document.querySelectorAll<HTMLButtonElement>('.resource-tab')) {
    tab.classList.toggle('is-active', tab.dataset.resourceType === activeType);
    tab.addEventListener('click', () => {
      const type = tab.dataset.resourceType as LibraryType;
      activeType = type;
      sessionStorage.setItem(ACTIVE_LIBRARY_TAB_KEY, type);
      for (const item of document.querySelectorAll('.resource-tab')) item.classList.toggle('is-active', item === tab);
      render();
    });
  }

  registerButton?.addEventListener('click', () => registerFile?.click());
  registerFile?.addEventListener('change', async () => {
    const file = registerFile.files?.[0];
    registerFile.value = '';
    if (!file) return;
    if (!/\.(png|jpe?g)$/iu.test(file.name) && !['image/png', 'image/jpeg'].includes(file.type)) {
      setLibraryStatus('Elegí un fondo en formato PNG o JPG.', true);
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setLibraryStatus('El fondo supera el límite de 12 MB.', true);
      return;
    }
    registerButton!.disabled = true;
    setLibraryStatus('Validando y registrando el recurso…', false);
    try {
      const result = await importBackgroundResource(file);
      setLibraryStatus(
        result.created
          ? `${result.resource.label} quedó guardado. Actualizando la biblioteca…`
          : `${result.resource.label} ya estaba guardado. Actualizando…`,
        false,
      );
      sessionStorage.setItem(ACTIVE_LIBRARY_TAB_KEY, 'background');
      window.location.reload();
    } catch (error) {
      setLibraryStatus(error instanceof Error ? error.message : 'No se pudo registrar el recurso.', true);
      registerButton!.disabled = false;
    }
  });

  function setLibraryStatus(message: string, isError: boolean): void {
    if (!libraryStatus) return;
    libraryStatus.textContent = message;
    libraryStatus.classList.toggle('error', isError);
  }

  function render(): void {
    root!.replaceChildren(...store.resources(activeType).map(resourceCard));
  }

  function resourceCard(resource: ResourceEntry): HTMLElement {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'resource-card';
    card.title = `Aplicar ${resource.label} a la escena seleccionada`;
    const thumbnail = resource.characterRef
      ? thumbnails.get(resource.characterRef.entryId)
      : resource.type === 'background' ? thumbnails.get(resource.id) : null;
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
