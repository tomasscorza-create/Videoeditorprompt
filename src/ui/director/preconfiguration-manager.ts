import { notify } from '../notifications.js';
import {
  deleteDirectorPreconfiguration,
  listDirectorAuthoringResources,
  listDirectorPreconfigurations,
  saveDirectorPreconfiguration,
  type DirectorAuthoringResource,
  type DirectorPreconfiguration,
  type DirectorPreconfigurationBinding,
  type DirectorPreconfigurationRecord,
} from './api.js';

interface ManagerOptions {
  openButton: HTMLButtonElement;
  selectedId: () => string | undefined;
  onRecordsChanged: (records: DirectorPreconfigurationRecord[], selectedId?: string) => void;
}

export function initDirectorPreconfigurationManager(options: ManagerOptions): void {
  const dialog = buildDialog();
  document.body.append(dialog);
  const form = scoped<HTMLFormElement>(dialog, '.preconfiguration-form');
  const picker = scoped<HTMLSelectElement>(dialog, '.preconfiguration-picker');
  const createButton = scoped<HTMLButtonElement>(dialog, '.preconfiguration-new');
  const deleteButton = scoped<HTMLButtonElement>(dialog, '.preconfiguration-delete');
  const closeButtons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('[data-close-preconfiguration]'));
  const addBindingButton = scoped<HTMLButtonElement>(dialog, '.preconfiguration-add-binding');
  const bindingList = scoped<HTMLElement>(dialog, '.preconfiguration-bindings');
  const backgrounds = scoped<HTMLElement>(dialog, '.preconfiguration-backgrounds');
  const narrator = scoped<HTMLSelectElement>(dialog, '[name="narratorVoiceResourceId"]');
  const strategy = scoped<HTMLSelectElement>(dialog, '[name="backgroundStrategy"]');
  const status = scoped<HTMLElement>(dialog, '.preconfiguration-status');
  const saveButton = scoped<HTMLButtonElement>(dialog, '.preconfiguration-save');
  let records: DirectorPreconfigurationRecord[] = [];
  let resources: DirectorAuthoringResource[] = [];
  let editingId: string | null = null;
  let editingRevision: number | undefined;

  options.openButton.addEventListener('click', () => void open());
  closeButtons.forEach((button) => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  picker.addEventListener('change', () => {
    const record = records.find((candidate) => candidate.preconfiguration.id === picker.value);
    renderEditor(record ?? null);
  });
  createButton.addEventListener('click', () => renderEditor(null));
  deleteButton.addEventListener('click', () => void removeCurrent());
  addBindingButton.addEventListener('click', () => {
    if (bindingList.children.length >= 8) return setStatus('Una configuración admite hasta ocho personajes.', true);
    bindingList.append(createBindingRow());
    syncAddBindingState();
  });
  strategy.addEventListener('change', syncBackgroundHint);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveCurrent();
  });

  async function open(): Promise<void> {
    options.openButton.disabled = true;
    setStatus('Cargando recursos y configuraciones…');
    try {
      [records, resources] = await Promise.all([
        listDirectorPreconfigurations(),
        listDirectorAuthoringResources(),
      ]);
      assertCatalogResources(resources);
      renderPicker();
      renderResourceOptions();
      const selected = records.find((record) => record.preconfiguration.id === options.selectedId())
        ?? records[0]
        ?? null;
      dialog.showModal();
      renderEditor(selected);
    } catch (error) {
      notify({ message: errorMessage(error, 'No se pudo abrir el administrador de configuraciones.'), level: 'error' });
    } finally {
      options.openButton.disabled = false;
    }
  }

  function renderPicker(): void {
    picker.replaceChildren(
      new Option('Nueva configuración', '__new__'),
      ...records.map((record) => new Option(record.preconfiguration.name, record.preconfiguration.id)),
    );
  }

  function renderResourceOptions(): void {
    narrator.replaceChildren(
      new Option('Sin voz narradora', ''),
      ...resourcesOfType('voice').map(resourceOption),
    );
    backgrounds.replaceChildren(...resourcesOfType('background').map((resource) => {
      const label = document.createElement('label');
      label.className = 'preconfiguration-check';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = resource.id;
      input.addEventListener('change', () => {
        const checked = backgrounds.querySelectorAll<HTMLInputElement>('input:checked');
        if (checked.length > 4) {
          input.checked = false;
          setStatus('Elegí hasta cuatro fondos preferidos.', true);
        } else syncBackgroundHint();
      });
      const text = document.createElement('span');
      text.textContent = resource.label;
      label.append(input, text);
      return label;
    }));
  }

  function renderEditor(record: DirectorPreconfigurationRecord | null): void {
    editingId = record?.preconfiguration.id ?? null;
    editingRevision = record?.revision;
    picker.value = editingId ?? '__new__';
    deleteButton.disabled = !record;
    const value = record?.preconfiguration;
    field<HTMLInputElement>('name').value = value?.name ?? '';
    field<HTMLTextAreaElement>('description').value = value?.description ?? '';
    field<HTMLSelectElement>('structurePreference').value = value?.structurePreference ?? 'automatic';
    field<HTMLSelectElement>('richnessProfile').value = value?.richnessProfile ?? 'automatic';
    narrator.value = value?.narratorVoiceResourceId ?? '';
    strategy.value = value?.backgroundStrategy ?? 'single-location';
    field<HTMLInputElement>('preserveCharacterVoices').checked = value?.continuity.preserveCharacterVoices ?? true;
    field<HTMLInputElement>('preserveNarratorVoice').checked = value?.continuity.preserveNarratorVoice ?? true;
    field<HTMLInputElement>('preserveCastAcrossScenes').checked = value?.continuity.preserveCastAcrossScenes ?? true;
    bindingList.replaceChildren(...(value?.characterBindings ?? []).map(createBindingRow));
    for (const input of backgrounds.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      input.checked = value?.preferredBackgroundResourceIds.includes(input.value) ?? false;
    }
    setStatus(record ? `Editando «${value!.name}».` : 'Creá una combinación reutilizable de reparto, voces y fondos.');
    syncAddBindingState();
    syncBackgroundHint();
    field<HTMLInputElement>('name').focus({ preventScroll: true });
  }

  function createBindingRow(binding?: DirectorPreconfigurationBinding): HTMLElement {
    const row = document.createElement('div');
    row.className = 'preconfiguration-binding';
    const role = labeledInput('Nombre del rol', 'text', 'Ejemplo: Presentador');
    role.input.className = 'preconfiguration-role';
    role.input.maxLength = 64;
    role.input.value = binding?.roleId ?? '';
    const character = labeledSelect('Personaje', resourcesOfType('character'));
    character.select.className = 'preconfiguration-character';
    const voice = labeledSelect('Voz fija', resourcesOfType('voice'));
    voice.select.className = 'preconfiguration-voice';
    const animation = labeledSelect('Animación habitual', []);
    animation.select.className = 'preconfiguration-animation';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'text-button preconfiguration-remove-binding';
    remove.textContent = 'Quitar';
    remove.addEventListener('click', () => {
      row.remove();
      syncAddBindingState();
    });
    character.select.addEventListener('change', () => renderAnimationOptions(character.select, animation.select));
    row.append(role.label, character.label, voice.label, animation.label, remove);
    character.select.value = binding?.characterResourceId ?? character.select.options[0]?.value ?? '';
    voice.select.value = binding?.voiceResourceId ?? voice.select.options[0]?.value ?? '';
    renderAnimationOptions(character.select, animation.select, binding?.animationPresetId);
    return row;
  }

  function renderAnimationOptions(character: HTMLSelectElement, animation: HTMLSelectElement, selected?: string): void {
    const entry = resources.find((resource) => resource.id === character.value);
    const presets = entry?.capabilities?.animationPresets ?? [];
    animation.replaceChildren(...presets.map((preset) => new Option(humanPreset(preset), preset)));
    if (selected && presets.includes(selected)) animation.value = selected;
  }

  async function saveCurrent(): Promise<void> {
    let document: DirectorPreconfiguration;
    try {
      document = readDocument();
    } catch (error) {
      setStatus(errorMessage(error, 'Revisá los campos marcados.'), true);
      return;
    }
    setBusy(true);
    setStatus('Guardando configuración…');
    try {
      const saved = await saveDirectorPreconfiguration(document, editingRevision);
      records = await listDirectorPreconfigurations();
      editingId = saved.preconfiguration.id;
      editingRevision = saved.revision;
      renderPicker();
      picker.value = editingId;
      deleteButton.disabled = false;
      options.onRecordsChanged(records, editingId);
      setStatus(`«${saved.preconfiguration.name}» quedó guardada.`);
      notify({ message: `Configuración «${saved.preconfiguration.name}» guardada.`, level: 'success' });
    } catch (error) {
      setStatus(errorMessage(error, 'No se pudo guardar la configuración.'), true);
    } finally {
      setBusy(false);
    }
  }

  async function removeCurrent(): Promise<void> {
    const record = records.find((candidate) => candidate.preconfiguration.id === editingId);
    if (!record || !window.confirm(`¿Eliminar la configuración «${record.preconfiguration.name}»?`)) return;
    setBusy(true);
    try {
      await deleteDirectorPreconfiguration(record.preconfiguration.id, record.revision);
      records = await listDirectorPreconfigurations();
      renderPicker();
      renderEditor(records[0] ?? null);
      options.onRecordsChanged(records, records[0]?.preconfiguration.id);
      notify({ message: `Configuración «${record.preconfiguration.name}» eliminada.`, level: 'success' });
    } catch (error) {
      setStatus(errorMessage(error, 'No se pudo eliminar la configuración.'), true);
    } finally {
      setBusy(false);
    }
  }

  function readDocument(): DirectorPreconfiguration {
    const name = field<HTMLInputElement>('name').value.trim();
    if (!name) throw new Error('Escribí un nombre para la configuración.');
    const description = field<HTMLTextAreaElement>('description').value.trim();
    const characterBindings = Array.from(bindingList.querySelectorAll<HTMLElement>('.preconfiguration-binding')).map((row) => {
      const roleId = slug(row.querySelector<HTMLInputElement>('.preconfiguration-role')?.value ?? '');
      const characterResourceId = row.querySelector<HTMLSelectElement>('.preconfiguration-character')?.value ?? '';
      const voiceResourceId = row.querySelector<HTMLSelectElement>('.preconfiguration-voice')?.value ?? '';
      const animationPresetId = row.querySelector<HTMLSelectElement>('.preconfiguration-animation')?.value ?? '';
      if (roleId.length < 2) throw new Error('Cada personaje necesita un nombre de rol de al menos dos caracteres.');
      if (!characterResourceId || !voiceResourceId || !animationPresetId) throw new Error('Completá personaje, voz y animación en cada vínculo.');
      return { roleId, characterResourceId, voiceResourceId, animationPresetId };
    });
    assertUnique(characterBindings.map((binding) => binding.roleId), 'Los nombres de rol no pueden repetirse.');
    assertUnique(characterBindings.map((binding) => binding.characterResourceId), 'Un personaje no puede ocupar dos roles en la misma configuración.');
    assertUnique(characterBindings.map((binding) => binding.voiceResourceId), 'Cada personaje necesita una voz diferente.');
    const narratorVoiceResourceId = narrator.value || undefined;
    if (characterBindings.length === 0 && !narratorVoiceResourceId) throw new Error('Agregá un personaje con voz o elegí una voz narradora.');
    const preferredBackgroundResourceIds = Array.from(backgrounds.querySelectorAll<HTMLInputElement>('input:checked')).map((input) => input.value);
    if (preferredBackgroundResourceIds.length === 0) throw new Error('Elegí al menos un fondo preferido.');
    if (strategy.value === 'single-location' && preferredBackgroundResourceIds.length !== 1) throw new Error('Locación única requiere exactamente un fondo.');
    if (strategy.value === 'beat-variation' && preferredBackgroundResourceIds.length < 2) throw new Error('Variación por momentos requiere al menos dos fondos.');
    const structurePreference = field<HTMLSelectElement>('structurePreference').value as DirectorPreconfiguration['structurePreference'];
    if (structurePreference === 'dialogue' && characterBindings.length < 2) throw new Error('La estructura de diálogo requiere al menos dos personajes.');
    if (structurePreference === 'one-character' && characterBindings.length < 1) throw new Error('La estructura de un personaje requiere un vínculo personaje-voz.');
    if (structurePreference === 'narration' && !narratorVoiceResourceId) throw new Error('La narración requiere una voz narradora.');
    const richnessValue = field<HTMLSelectElement>('richnessProfile').value;
    return {
      version: 1,
      id: editingId ?? uniqueId(slug(name), records.map((record) => record.preconfiguration.id)),
      name,
      ...(description ? { description } : {}),
      structurePreference,
      ...(richnessValue === 'automatic' ? {} : { richnessProfile: richnessValue as DirectorPreconfiguration['richnessProfile'] }),
      characterBindings,
      ...(narratorVoiceResourceId ? { narratorVoiceResourceId } : {}),
      preferredBackgroundResourceIds,
      backgroundStrategy: strategy.value as DirectorPreconfiguration['backgroundStrategy'],
      continuity: {
        preserveCharacterVoices: field<HTMLInputElement>('preserveCharacterVoices').checked,
        preserveNarratorVoice: field<HTMLInputElement>('preserveNarratorVoice').checked,
        preserveCastAcrossScenes: field<HTMLInputElement>('preserveCastAcrossScenes').checked,
      },
    };
  }

  function field<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(name: string): T {
    return scoped<T>(form, `[name="${name}"]`);
  }

  function resourcesOfType(type: string): DirectorAuthoringResource[] {
    return resources.filter((resource) => resource.type === type).sort((left, right) => left.label.localeCompare(right.label, 'es'));
  }

  function syncAddBindingState(): void {
    addBindingButton.disabled = bindingList.children.length >= 8;
  }

  function syncBackgroundHint(): void {
    const count = backgrounds.querySelectorAll('input:checked').length;
    const hint = scoped<HTMLElement>(dialog, '.preconfiguration-background-hint');
    hint.textContent = strategy.value === 'single-location'
      ? `${count} seleccionado. Locación única usa exactamente uno.`
      : `${count} seleccionados. La variación usa entre dos y cuatro.`;
  }

  function setBusy(busy: boolean): void {
    saveButton.disabled = busy;
    deleteButton.disabled = busy || !editingId;
    createButton.disabled = busy;
    addBindingButton.disabled = busy || bindingList.children.length >= 8;
  }

  function setStatus(message: string, error = false): void {
    status.textContent = message;
    status.classList.toggle('error', error);
  }
}

function buildDialog(): HTMLDialogElement {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal preconfiguration-modal';
  dialog.setAttribute('aria-labelledby', 'preconfiguration-modal-title');
  dialog.innerHTML = `
    <div class="modal-content">
      <header class="section-header">
        <div><span class="eyebrow">Director IA</span><h2 id="preconfiguration-modal-title">Configuraciones creativas</h2></div>
        <button class="text-button" type="button" data-close-preconfiguration>Cerrar</button>
      </header>
      <p class="muted preconfiguration-intro">Guardá combinaciones de personajes, voces y fondos para reutilizarlas al crear un video.</p>
      <div class="preconfiguration-toolbar">
        <label class="field"><span>Configuración</span><select class="preconfiguration-picker"></select></label>
        <button class="secondary-button preconfiguration-new" type="button">Nueva</button>
        <button class="text-button preconfiguration-delete" type="button">Eliminar</button>
      </div>
      <form class="preconfiguration-form">
        <section class="preconfiguration-section">
          <h3>Identidad</h3>
          <div class="preconfiguration-grid two-columns">
            <label class="field"><span>Nombre</span><input name="name" maxlength="100" required placeholder="Ejemplo: Dupla principal"></label>
            <label class="field"><span>Estructura</span><select name="structurePreference"><option value="automatic">Automática</option><option value="narration">Narración</option><option value="one-character">Un personaje</option><option value="dialogue">Diálogo</option></select></label>
            <label class="field full-row"><span>Descripción opcional</span><textarea name="description" maxlength="300" rows="2" placeholder="Cuándo conviene usar esta configuración"></textarea></label>
            <label class="field"><span>Riqueza visual</span><select name="richnessProfile"><option value="automatic">Automática</option><option value="simple">Simple</option><option value="varied">Variada</option><option value="dynamic">Dinámica</option></select></label>
            <label class="field"><span>Voz narradora</span><select name="narratorVoiceResourceId"></select></label>
          </div>
        </section>
        <section class="preconfiguration-section">
          <div class="preconfiguration-section-heading"><div><h3>Personajes y voces</h3><p>La voz queda ligada al rol en todas las escenas.</p></div><button class="secondary-button preconfiguration-add-binding" type="button">Agregar personaje</button></div>
          <div class="preconfiguration-bindings"></div>
        </section>
        <section class="preconfiguration-section">
          <div class="preconfiguration-grid two-columns">
            <label class="field"><span>Uso de fondos</span><select name="backgroundStrategy"><option value="single-location">Locación única</option><option value="beat-variation">Variar por momentos</option></select></label>
            <p class="muted preconfiguration-background-hint"></p>
          </div>
          <div class="preconfiguration-backgrounds" aria-label="Fondos preferidos"></div>
        </section>
        <details class="preconfiguration-continuity">
          <summary>Reglas de continuidad</summary>
          <label><input type="checkbox" name="preserveCharacterVoices" checked> Mantener la voz de cada personaje</label>
          <label><input type="checkbox" name="preserveNarratorVoice" checked> Mantener la voz narradora</label>
          <label><input type="checkbox" name="preserveCastAcrossScenes" checked> Mantener el reparto entre escenas</label>
        </details>
        <p class="preconfiguration-status muted" role="status" aria-live="polite"></p>
        <footer class="preconfiguration-actions"><button class="text-button" type="button" data-close-preconfiguration>Cancelar</button><button class="primary-button preconfiguration-save" type="submit">Guardar configuración</button></footer>
      </form>
    </div>`;
  return dialog;
}

function labeledInput(text: string, type: string, placeholder: string) {
  const label = document.createElement('label');
  label.className = 'field';
  const caption = document.createElement('span');
  caption.textContent = text;
  const input = document.createElement('input');
  input.type = type;
  input.placeholder = placeholder;
  label.append(caption, input);
  return { label, input };
}

function labeledSelect(text: string, resources: DirectorAuthoringResource[]) {
  const label = document.createElement('label');
  label.className = 'field';
  const caption = document.createElement('span');
  caption.textContent = text;
  const select = document.createElement('select');
  select.replaceChildren(...resources.map(resourceOption));
  label.append(caption, select);
  return { label, select };
}

function resourceOption(resource: DirectorAuthoringResource): HTMLOptionElement {
  return new Option(resource.label, resource.id);
}

function assertCatalogResources(resources: DirectorAuthoringResource[]): void {
  for (const type of ['character', 'voice', 'background']) {
    if (!resources.some((resource) => resource.type === type)) throw new Error(`El catálogo no contiene recursos de tipo ${type}.`);
  }
}

function assertUnique(values: string[], message: string): void {
  if (new Set(values).size !== values.length) throw new Error(message);
}

function uniqueId(base: string, existing: string[]): string {
  const safeBase = base.length >= 2 ? base.slice(0, 56) : 'configuracion';
  if (!existing.includes(safeBase)) return safeBase;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${safeBase.slice(0, 59)}-${index}`;
    if (!existing.includes(candidate)) return candidate;
  }
  throw new Error('No se pudo crear un identificador único para la configuración.');
}

function slug(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 64);
}

function humanPreset(value: string): string {
  return value.replaceAll('-', ' ').replace(/^./u, (letter) => letter.toUpperCase());
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function scoped<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`No se encontró ${selector}`);
  return element;
}
