export const CHARACTER_DRAG_TYPE = 'application/x-local-video-character';
export const CHARACTER_PLACEMENT_EVENT = 'local-video-character-placement';

export interface CharacterPlacement {
  resourceId: string;
  label: string;
}

let current: CharacterPlacement | null = null;

export function beginCharacterPlacement(resourceId: string, label: string): void {
  current = { resourceId, label };
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

export function readCharacterDrag(dataTransfer: DataTransfer | null): CharacterPlacement | null {
  if (!dataTransfer) return null;
  try {
    const parsed = JSON.parse(dataTransfer.getData(CHARACTER_DRAG_TYPE)) as CharacterPlacement;
    return parsed && typeof parsed.resourceId === 'string' && typeof parsed.label === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function notify(): void {
  window.dispatchEvent(new CustomEvent(CHARACTER_PLACEMENT_EVENT, { detail: current }));
}
