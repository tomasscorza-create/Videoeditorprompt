export const CHARACTER_DRAG_TYPE = 'application/x-local-video-character';
export const PROP_DRAG_TYPE = 'application/x-local-video-prop';
export const CHARACTER_PLACEMENT_EVENT = 'local-video-character-placement';

export interface CharacterPlacement {
  resourceId: string;
  label: string;
  type?: 'character' | 'prop';
}

let current: CharacterPlacement | null = null;

export function beginCharacterPlacement(resourceId: string, label: string): void {
  current = { resourceId, label, type: 'character' };
  notify();
}

export function beginPropPlacement(resourceId: string, label: string): void {
  current = { resourceId, label, type: 'prop' };
  notify();
}

export function currentCharacterPlacement(): CharacterPlacement | null {
  return current;
}

export function finishCharacterPlacement(): void {
  current = null;
  notify();
}

export function writeCharacterDrag(dataTransfer: DataTransfer, placement: CharacterPlacement): void {
  dataTransfer.effectAllowed = 'copy';
  dataTransfer.setData(CHARACTER_DRAG_TYPE, JSON.stringify(placement));
  dataTransfer.setData('text/plain', placement.label);
}

export function writePropDrag(dataTransfer: DataTransfer, placement: CharacterPlacement): void {
  dataTransfer.effectAllowed = 'copy';
  dataTransfer.setData(PROP_DRAG_TYPE, JSON.stringify({ ...placement, type: 'prop' }));
  dataTransfer.setData('text/plain', placement.label);
}

export function readCharacterDrag(dataTransfer: DataTransfer | null): CharacterPlacement | null {
  if (!dataTransfer) return null;
  try {
    const parsed = JSON.parse(dataTransfer.getData(CHARACTER_DRAG_TYPE)) as CharacterPlacement;
    return parsed && typeof parsed.resourceId === 'string' && typeof parsed.label === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function readPropDrag(dataTransfer: DataTransfer | null): CharacterPlacement | null {
  if (!dataTransfer) return null;
  try {
    const parsed = JSON.parse(dataTransfer.getData(PROP_DRAG_TYPE)) as CharacterPlacement;
    return parsed && typeof parsed.resourceId === 'string' && typeof parsed.label === 'string'
      ? { ...parsed, type: 'prop' }
      : null;
  } catch {
    return null;
  }
}

export const BACKGROUND_DRAG_TYPE = 'application/x-local-video-background';

// Arrastre de fondos desde la biblioteca (B5): solo transporta el resourceId. El
// cameraPreset lo resuelve el destino según lo que el fondo soporte.
export function writeBackgroundDrag(dataTransfer: DataTransfer, resourceId: string, label: string): void {
  dataTransfer.effectAllowed = 'copy';
  dataTransfer.setData(BACKGROUND_DRAG_TYPE, resourceId);
  dataTransfer.setData('text/plain', label);
}

export function readBackgroundDrag(dataTransfer: DataTransfer | null): string | null {
  const resourceId = dataTransfer?.getData(BACKGROUND_DRAG_TYPE);
  return resourceId && resourceId.length > 0 ? resourceId : null;
}

function notify(): void {
  window.dispatchEvent(new CustomEvent(CHARACTER_PLACEMENT_EVENT, { detail: current }));
}
