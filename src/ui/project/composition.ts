import { optional } from '../dom.js';
import type { ProjectStore } from './store.js';

interface AssetCatalogEntry {
  id: string;
  thumbnail?: string;
}

interface AssetCatalog {
  entries: AssetCatalogEntry[];
}

export async function initCompositionPreview(store: ProjectStore): Promise<void> {
  const canvas = optional<HTMLElement>('#composition-canvas');
  if (!canvas) return;
  let assetCatalog: AssetCatalog = { entries: [] };
  let renderVersion = 0;
  try {
    const response = await fetch('/assets/catalog/index.json', { cache: 'no-store' });
    if (response.ok) assetCatalog = await response.json() as AssetCatalog;
  } catch {
    // Los textos y el fondo siguen aportando una vista útil si una miniatura falla.
  }

  const render = (): void => {
    const version = ++renderVersion;
    const project = store.project();
    const scene = project.scenes.find((item) => item.id === store.selectedSceneId()) ?? project.scenes[0];
    if (!scene) {
      canvas.replaceChildren(empty('No hay una escena seleccionada.'));
      return;
    }
    const nodes: HTMLElement[] = [];
    const background = store.resources('background').find((entry) => entry.id === scene.background.resourceId);
    if (background?.backgroundManifest) {
      void appendBackground(canvas, background.backgroundManifest, nodes, () => version === renderVersion);
    } else {
      nodes.push(label(scene.title));
      canvas.replaceChildren(...nodes);
    }

    for (const element of [...scene.elements].sort((a, b) => a.transform.zIndex - b.transform.zIndex)) {
      if (element.type !== 'character' || !element.resourceId) continue;
      const resource = store.resources('character').find((entry) => entry.id === element.resourceId);
      const entry = assetCatalog.entries.find((item) => item.id === resource?.characterRef?.entryId);
      if (!entry?.thumbnail) continue;
      const image = document.createElement('img');
      image.className = 'composition-character';
      image.src = `/${entry.thumbnail}`;
      image.alt = '';
      image.style.left = `${element.transform.x / 10.8}%`;
      image.style.top = `${element.transform.y / 19.2}%`;
      image.style.zIndex = String(element.transform.zIndex);
      image.style.opacity = String((element.transform as unknown as { opacity?: number }).opacity ?? 1);
      image.style.transform = `translate(-50%, -50%) scale(${element.transform.scale})`;
      nodes.push(image);
    }
    nodes.push(label(`${scene.title} · ${scene.background.cameraPreset}`));
    canvas.replaceChildren(...nodes);
  };

  store.subscribe(render);
  render();
}

async function appendBackground(
  canvas: HTMLElement,
  manifestPath: string,
  foregroundNodes: HTMLElement[],
  isCurrent: () => boolean,
): Promise<void> {
  try {
    const response = await fetch(`/${manifestPath}`, { cache: 'force-cache' });
    if (!response.ok) throw new Error(String(response.status));
    const manifest = await response.json() as { layers?: Record<string, string> };
    const base = manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1);
    const layers = ['far', 'mid', 'front'].flatMap((key) => manifest.layers?.[key] ? [manifest.layers[key]] : []);
    const backgroundNodes = layers.map((path, index) => {
      const image = document.createElement('img');
      image.className = 'composition-layer';
      image.src = `/${base}${path}`;
      image.alt = '';
      image.style.zIndex = String(index);
      return image;
    });
    if (isCurrent()) canvas.replaceChildren(...backgroundNodes, ...foregroundNodes);
  } catch {
    if (isCurrent()) canvas.replaceChildren(...foregroundNodes);
  }
}

function label(text: string): HTMLElement {
  const node = document.createElement('span');
  node.className = 'composition-label';
  node.textContent = text;
  node.style.zIndex = '2000';
  return node;
}

function empty(text: string): HTMLElement {
  const node = document.createElement('p');
  node.className = 'viewer-empty';
  node.textContent = text;
  return node;
}
