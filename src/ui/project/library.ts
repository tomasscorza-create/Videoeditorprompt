import { optional } from '../dom.js';
import { notify } from '../notifications.js';
import { importBackgroundResource } from '../director/api.js';
import {
  CHARACTER_PLACEMENT_EVENT,
  beginCharacterPlacement,
  currentCharacterPlacement,
  writeBackgroundDrag,
  writeCharacterDrag,
} from './character-placement.js';
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
  const search = optional<HTMLInputElement>('#resource-search');
  let filter = '';
  search?.addEventListener('input', () => {
    filter = search.value.trim().toLowerCase();
    render();
  });
  window.addEventListener(CHARACTER_PLACEMENT_EVENT, () => {
    if (currentCharacterPlacement()) return;
    for (const item of root.querySelectorAll('.resource-card')) item.classList.remove('is-placement-source');
  });
  let activeType: LibraryType = sessionStorage.getItem(ACTIVE_LIBRARY_TAB_KEY) === 'background' ? 'background' : 'character';
  let thumbnails = new Map<string, string>();
  const characterCatalogs = new Set(
    store.resources('character')
      .flatMap((resource) => resource.characterRef?.catalog ? [resource.characterRef.catalog] : []),
  );
  for (const catalogPath of characterCatalogs) {
    try {
      const response = await fetch(`/${catalogPath}`, { cache: 'no-store' });
      const catalog = await response.json() as { entries?: Array<{ id: string; thumbnail?: string }> };
      for (const entry of catalog.entries ?? []) {
        if (entry.thumbnail) thumbnails.set(entry.id, entry.thumbnail);
      }
    } catch {
      // La biblioteca conserva etiquetas, tags y licencias sin miniaturas.
    }
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

  for (const tab of document.querySelectorAll<HTMLButtonElement>('.resource-tabs .tab')) {
    const isActive = tab.dataset.resourceType === activeType;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
    tab.addEventListener('click', () => {
      const type = tab.dataset.resourceType as LibraryType;
      activeType = type;
      sessionStorage.setItem(ACTIVE_LIBRARY_TAB_KEY, type);
      for (const item of document.querySelectorAll('.resource-tabs .tab')) {
        item.classList.toggle('is-active', item === tab);
        item.setAttribute('aria-selected', String(item === tab));
      }
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

  // U5: los fallos de la biblioteca también se notifican; el panel derecho
  // puede estar colapsado cuando ocurren.
  function setLibraryStatus(message: string, isError: boolean): void {
    if (libraryStatus) {
      libraryStatus.textContent = message;
      libraryStatus.classList.toggle('error', isError);
    }
    if (isError) notify({ message, level: 'error' });
  }

  // U2: filtro en vivo por nombre y etiquetas, del lado del cliente.
  function matchesFilter(resource: ResourceEntry): boolean {
    if (!filter) return true;
    const haystack = [resource.label, ...(resource.tags ?? [])].join(' ').toLowerCase();
    return haystack.includes(filter);
  }

  function render(): void {
    const all = store.resources(activeType);
    const visible = all.filter(matchesFilter);
    if (visible.length > 0) {
      root!.replaceChildren(...visible.map(resourceCard));
      return;
    }
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    if (all.length === 0) {
      empty.textContent = 'No hay recursos de este tipo todavía.';
      root!.replaceChildren(empty);
      return;
    }
    empty.textContent = `Ningún recurso coincide con «${filter}».`;
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'text-button';
    clear.textContent = 'Limpiar filtro';
    clear.addEventListener('click', () => {
      if (search) search.value = '';
      filter = '';
      render();
      search?.focus();
    });
    root!.replaceChildren(empty, clear);
  }

  function resourceCard(resource: ResourceEntry): HTMLElement {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'resource-card';
    card.title = resource.type === 'character'
      ? `Colocar ${resource.label} en el visor`
      : `Aplicar ${resource.label} a la escena seleccionada`;
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
    if (resource.type === 'character') {
      card.draggable = true;
      card.addEventListener('click', () => {
        beginCharacterPlacement(resource.id, resource.label);
        for (const item of root!.querySelectorAll('.resource-card')) item.classList.toggle('is-placement-source', item === card);
        setLibraryStatus(`Ahora hacé clic en el visor o arrastrá «${resource.label}» sobre el personaje que querés reemplazar.`, false);
      });
      card.addEventListener('dragstart', (event) => {
        beginCharacterPlacement(resource.id, resource.label);
        if (event.dataTransfer) writeCharacterDrag(event.dataTransfer, { resourceId: resource.id, label: resource.label });
        card.classList.add('is-dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('is-dragging'));
    } else if (resource.type === 'background') {
      card.draggable = true;
      card.addEventListener('click', () => apply(resource));
      card.addEventListener('dragstart', (event) => {
        if (event.dataTransfer) writeBackgroundDrag(event.dataTransfer, resource.id, resource.label);
        card.classList.add('is-dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('is-dragging'));
    } else {
      card.addEventListener('click', () => apply(resource));
    }
    return card;
  }

  function apply(resource: ResourceEntry): void {
    const scene = store.project().scenes.find((item) => item.id === store.selectedSceneId());
    if (!scene) return;
    let error: string | null = null;
    if (resource.type === 'background') {
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
