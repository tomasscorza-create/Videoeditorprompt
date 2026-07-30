import { optional } from '../dom.js';
import { notify } from '../notifications.js';
import { importBackgroundResource } from '../director/api.js';
import { listApplicablePresets } from '../../../shared/animation-presets.js';
import {
  CHARACTER_PLACEMENT_EVENT,
  beginCharacterPlacement,
  beginPropPlacement,
  beginTemplatePlacement,
  currentCharacterPlacement,
  writeBackgroundDrag,
  writeCharacterDrag,
  writePropDrag,
  writeTemplateDrag,
} from './character-placement.js';
import type { ProjectStore } from './store.js';
import type { ResourceEntry, ResourceType } from './types.js';
import { PROJECT_SELECTION_EVENT, projectSelection } from './selection.js';
import { showRightPanelPage } from '../right-panel.js';
import {
  loadVideoTemplateCatalog,
  loadVideoTemplateDefinition,
  openVideoTemplate,
  type VideoTemplateCatalog,
  type VideoTemplateSummary,
} from './video-template-catalog.js';

type LibraryType = Extract<ResourceType, 'character' | 'prop' | 'background' | 'voice'>;
type LibraryTab = LibraryType | 'template';
const ACTIVE_LIBRARY_TAB_KEY = 'local-video.library-active-tab';
const ACTIVE_TEMPLATE_CATEGORY_KEY = 'local-video.template-active-category';
const templateDefaultWords = new Map<string, string>();

/** C4: permite que otra superficie (el Director) pida mostrar un recurso. */
export const REVEAL_RESOURCE_EVENT = 'local-video:reveal-resource';

export function revealResource(resourceId: string): void {
  showRightPanelPage('resources');
  window.dispatchEvent(new CustomEvent<string>(REVEAL_RESOURCE_EVENT, { detail: resourceId }));
}

export async function initResourceLibrary(store: ProjectStore): Promise<void> {
  const root = optional<HTMLElement>('#resource-list');
  if (!root) return;
  const registerButton = optional<HTMLButtonElement>('#resource-register');
  const registerFile = optional<HTMLInputElement>('#resource-register-file');
  const libraryStatus = optional<HTMLElement>('#resource-library-status');
  const search = optional<HTMLInputElement>('#resource-search');
  const templateCategoryTabs = optional<HTMLElement>('#template-category-tabs');
  let filter = '';
  search?.addEventListener('input', () => {
    filter = search.value.trim().toLowerCase();
    render();
  });
  window.addEventListener(CHARACTER_PLACEMENT_EVENT, () => {
    if (currentCharacterPlacement()) return;
    for (const item of root.querySelectorAll('.resource-card')) item.classList.remove('is-placement-source');
  });
  const savedType = sessionStorage.getItem(ACTIVE_LIBRARY_TAB_KEY);
  let activeType: LibraryTab = ['character', 'prop', 'background', 'voice', 'template'].includes(savedType ?? '')
    ? savedType as LibraryTab
    : 'character';
  let templateCatalog: VideoTemplateCatalog | null = null;
  let templateCatalogError = '';
  let activeTemplateCategory = sessionStorage.getItem(ACTIVE_TEMPLATE_CATEGORY_KEY) ?? '';
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
  try {
    templateCatalog = await loadVideoTemplateCatalog();
    if (!templateCatalog.categories.some((category) => category.id === activeTemplateCategory)) {
      activeTemplateCategory = templateCatalog.categories[0]?.id ?? '';
    }
    // La palabra inicial la declara la definición, no la interfaz.
    await Promise.all(templateCatalog.templates.map(async (template) => {
      try {
        const definition = await loadVideoTemplateDefinition(template);
        templateDefaultWords.set(template.id, definition.defaultValues.word);
      } catch {
        // Sin definición la plantilla igual se lista: al abrirla se explica el fallo.
      }
    }));
  } catch (error) {
    templateCatalogError = error instanceof Error ? error.message : 'No se pudo cargar el catálogo de plantillas.';
  }
  function updateRegisterButton() {
    if (!registerButton) return;
    const templatesActive = activeType === 'template';
    registerButton.dataset.contextHidden = String(templatesActive);
    registerButton.hidden = templatesActive;
    if (activeType === 'background') registerButton.textContent = 'Agregar fondo';
    else if (activeType === 'character') registerButton.textContent = 'Crear personaje';
    else if (activeType === 'prop') registerButton.textContent = 'Props incluidos';
    else if (activeType === 'voice') registerButton.textContent = 'Agregar voz';
    if (search) search.placeholder = templatesActive
      ? 'Buscar plantillas'
      : 'Buscar por nombre o etiqueta';
    renderTemplateCategories();
  }
  updateRegisterButton();

  for (const tab of document.querySelectorAll<HTMLButtonElement>('.resource-tabs .tab')) {
    const isActive = tab.dataset.resourceType === activeType;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
    tab.addEventListener('click', () => {
      const type = tab.dataset.resourceType as LibraryTab;
      activeType = type;
      sessionStorage.setItem(ACTIVE_LIBRARY_TAB_KEY, type);
      for (const item of document.querySelectorAll('.resource-tabs .tab')) {
        item.classList.toggle('is-active', item === tab);
        item.setAttribute('aria-selected', String(item === tab));
      }
      updateRegisterButton();
      render();
    });
  }

  // C4: al pedir un recurso desde el Director se abre su pestaña, se limpia el
  // filtro que pudiera ocultarlo y se destaca su tarjeta.
  window.addEventListener(REVEAL_RESOURCE_EVENT, (event) => {
    const resourceId = (event as CustomEvent<string>).detail;
    const owner = (['character', 'prop', 'background', 'voice'] as LibraryType[])
      .find((type) => store.resources(type).some((resource) => resource.id === resourceId));
    if (!owner) return;
    if (owner !== activeType) {
      activeType = owner;
      sessionStorage.setItem(ACTIVE_LIBRARY_TAB_KEY, owner);
      for (const item of document.querySelectorAll('.resource-tabs .tab')) {
        const isOwner = (item as HTMLElement).dataset.resourceType === owner;
        item.classList.toggle('is-active', isOwner);
        item.setAttribute('aria-selected', String(isOwner));
      }
      updateRegisterButton();
    }
    if (filter) {
      filter = '';
      if (search) search.value = '';
    }
    render();
    const card = root.querySelector<HTMLElement>(`[data-resource-id="${CSS.escape(resourceId)}"]`);
    if (!card) return;
    card.scrollIntoView({ block: 'nearest' });
    card.classList.add('is-revealed');
    card.addEventListener('animationend', () => card.classList.remove('is-revealed'), { once: true });
  });

  registerButton?.addEventListener('click', () => {
    if (activeType === 'background') {
      registerFile?.click();
    } else if (activeType === 'character') {
      optional<HTMLElement>('#workspace-creator')?.click();
    } else if (activeType === 'prop') {
      notify({ message: 'Los props incluidos ya están disponibles para colocar.', level: 'info' });
    } else if (activeType === 'voice') {
      notify({ message: 'La carga de voces se habilitará en una próxima etapa.', level: 'info' });
    }
  });
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
    if (activeType === 'template') {
      renderTemplates();
      return;
    }
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

  function renderTemplateCategories(): void {
    if (!templateCategoryTabs) return;
    templateCategoryTabs.hidden = activeType !== 'template';
    if (activeType !== 'template') return;
    if (!templateCatalog || templateCatalog.categories.length === 0) {
      templateCategoryTabs.replaceChildren();
      return;
    }
    templateCategoryTabs.replaceChildren(...templateCatalog.categories.map((category) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tab';
      button.textContent = category.label;
      button.dataset.templateCategory = category.id;
      const selected = category.id === activeTemplateCategory;
      button.classList.toggle('is-active', selected);
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(selected));
      button.addEventListener('click', () => {
        activeTemplateCategory = category.id;
        sessionStorage.setItem(ACTIVE_TEMPLATE_CATEGORY_KEY, category.id);
        renderTemplateCategories();
        render();
      });
      return button;
    }));
  }

  function renderTemplates(): void {
    if (templateCatalogError) {
      const error = document.createElement('p');
      error.className = 'empty-state error';
      error.textContent = templateCatalogError;
      root!.replaceChildren(error);
      return;
    }
    const category = templateCatalog?.categories.find((item) => item.id === activeTemplateCategory);
    const all = (templateCatalog?.templates ?? [])
      .filter((template) => template.categoryId === activeTemplateCategory);
    const visible = all.filter((template) => {
      if (!filter) return true;
      return [template.label, template.description, ...template.tags].join(' ').toLowerCase().includes(filter);
    });
    if (visible.length > 0) {
      root!.replaceChildren(...visible.map(templateCard));
      return;
    }
    const empty = document.createElement('div');
    empty.className = 'template-empty-state';
    const title = document.createElement('strong');
    title.textContent = filter ? `No hay resultados para «${filter}».` : `Todavía no hay plantillas en ${category?.label ?? 'esta categoría'}.`;
    const detail = document.createElement('span');
    detail.textContent = filter
      ? 'Probá con otro nombre o etiqueta.'
      : category?.description ?? 'Las plantillas disponibles aparecerán aquí.';
    const readiness = document.createElement('small');
    readiness.textContent = 'Esta sección ya está preparada para cargar videos prearmados y abrir sus opciones editables.';
    empty.append(title, detail, readiness);
    root!.replaceChildren(empty);
  }

  function templateCard(template: VideoTemplateSummary): HTMLElement {
    const card = document.createElement('article');
    card.className = 'resource-card template-card';
    card.dataset.templateId = template.id;
    const primary = document.createElement('button');
    primary.type = 'button';
    primary.className = 'resource-card-primary';
    primary.title = `Editar la plantilla ${template.label}`;
    if (template.thumbnail) {
      const image = document.createElement('img');
      image.src = `/${template.thumbnail}`;
      image.alt = `Vista previa de ${template.label}`;
      primary.append(image);
    }
    const name = document.createElement('strong');
    name.textContent = template.label;
    const description = document.createElement('span');
    description.className = 'resource-tags';
    description.textContent = template.description;
    primary.append(name, description);
    primary.addEventListener('click', () => openVideoTemplate(template));

    // Arrastrar la tarjeta al visor agrega la plantilla al video; el clic sigue
    // abriendo el editor para probarla sin tocar el proyecto.
    card.draggable = true;
    card.addEventListener('dragstart', (event) => {
      if (!event.dataTransfer) return;
      writeTemplateDrag(event.dataTransfer, {
        resourceId: template.id,
        label: template.label,
        type: 'template',
        word: templateDefaultWords.get(template.id),
      });
      card.classList.add('is-placement-source');
    });
    card.addEventListener('dragend', () => card.classList.remove('is-placement-source'));

    const place = document.createElement('button');
    place.type = 'button';
    place.className = 'resource-card-action';
    place.textContent = 'Agregar al video';
    place.title = `Agregar ${template.label} a la escena actual`;
    place.addEventListener('click', () => {
      beginTemplatePlacement(template.id, template.label, templateDefaultWords.get(template.id));
    });
    card.append(primary, place);
    return card;
  }

  function resourceCard(resource: ResourceEntry): HTMLElement {
    const card = document.createElement('article');
    card.className = 'resource-card';
    card.dataset.resourceId = resource.id;
    const primary = document.createElement('button');
    primary.type = 'button';
    primary.className = 'resource-card-primary';
    primary.title = resource.type === 'character' || resource.type === 'prop'
      ? `Colocar ${resource.label} en el visor`
      : `Aplicar ${resource.label} a la escena seleccionada`;
    const thumbnail = resource.characterRef
      ? thumbnails.get(resource.characterRef.entryId)
      : resource.type === 'prop' ? resource.thumbnail
      : resource.type === 'background' ? thumbnails.get(resource.id) : null;
    if (thumbnail) {
      const image = document.createElement('img');
      image.src = `/${thumbnail}`;
      image.alt = `Miniatura de ${resource.label}`;
      primary.append(image);
    } else {
      const preview = document.createElement('span');
      preview.className = 'render-job-icon';
      preview.textContent = resource.type === 'voice' ? '♪' : '▧';
      primary.append(preview);
    }
    const name = document.createElement('strong');
    name.textContent = resource.label;
    const tags = document.createElement('span');
    tags.className = 'resource-tags';
    tags.textContent = resource.tags?.join(' · ') || resource.type;
    const license = document.createElement('span');
    license.className = 'resource-license';
    license.textContent = resource.provenance?.license || 'Licencia sin detalle';
    primary.append(name, tags, license);
    card.append(primary);
    if (resource.type === 'character') {
      card.draggable = true;
      primary.addEventListener('click', () => {
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
    } else if (resource.type === 'prop') {
      card.draggable = true;
      primary.addEventListener('click', () => {
        beginPropPlacement(resource.id, resource.label);
        for (const item of root!.querySelectorAll('.resource-card')) item.classList.toggle('is-placement-source', item === card);
        setLibraryStatus(`Ahora hacé clic en el visor o arrastrá «${resource.label}» para agregarlo.`, false);
      });
      card.addEventListener('dragstart', (event) => {
        beginPropPlacement(resource.id, resource.label);
        if (event.dataTransfer) writePropDrag(event.dataTransfer, { resourceId: resource.id, label: resource.label, type: 'prop' });
        card.classList.add('is-dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('is-dragging'));
    } else if (resource.type === 'background') {
      card.draggable = true;
      primary.addEventListener('click', () => apply(resource));
      card.addEventListener('dragstart', (event) => {
        if (event.dataTransfer) writeBackgroundDrag(event.dataTransfer, resource.id, resource.label);
        card.classList.add('is-dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('is-dragging'));
    } else {
      primary.addEventListener('click', () => apply(resource));
    }
    appendAnimationPresets(card, resource);
    return card;
  }

  function appendAnimationPresets(card: HTMLElement, resource: ResourceEntry): void {
    if (resource.type !== 'character' && resource.type !== 'prop') return;
    const selection = projectSelection();
    if (!selection || (selection.kind !== 'element' && selection.kind !== 'keyframe')) return;
    const scene = store.project().scenes.find((candidate) => candidate.id === selection.sceneId);
    const element = scene?.elements.find((candidate) => candidate.id === selection.elementId);
    if (!scene || !element || element.type !== resource.type || element.resourceId !== resource.id) return;

    const rawParameters = resource.capabilities?.parameters;
    const declaredParameters = Array.isArray(rawParameters)
      ? rawParameters.filter((value): value is string => typeof value === 'string')
      : [];
    const presets = listApplicablePresets(declaredParameters);
    if (presets.length === 0) return;

    const controls = document.createElement('section');
    controls.className = 'resource-animation-presets';
    const heading = document.createElement('span');
    heading.className = 'resource-animation-heading';
    heading.textContent = 'Animar seleccionado';
    const buttons = document.createElement('div');
    buttons.className = 'resource-animation-buttons';
    for (const preset of presets) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'animation-preset';
      button.textContent = preset.label;
      button.title = `Aplicar «${preset.label}» al inicio de la escena`;
      button.addEventListener('click', () => {
        const error = store.dispatch({
          type: 'apply-animation-preset',
          sceneId: scene.id,
          elementId: element.id,
          presetId: preset.id,
          anchor: { kind: 'scene', edge: 'start' },
          intensity: 'medium',
        });
        setLibraryStatus(
          error || `«${preset.label}» aplicado a ${resource.label} al inicio de la escena.`,
          Boolean(error),
        );
      });
      buttons.append(button);
    }
    controls.append(heading, buttons);
    card.append(controls);
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

  store.subscribe(render);
  window.addEventListener(PROJECT_SELECTION_EVENT, render);
  render();
}
