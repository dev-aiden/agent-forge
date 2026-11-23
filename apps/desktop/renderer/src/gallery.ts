// Starter templates from the repo's gallery/ folder, bundled at build time.
import { loadGallery, type GalleryKind, type GalleryTemplate } from "@kitroom/model/gallery";

const files = import.meta.glob("../../../../gallery/*/*.{md,json}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const ALL: GalleryTemplate[] = loadGallery(files);

export function templatesOf<K extends GalleryKind>(kind: K): Extract<GalleryTemplate, { kind: K }>[] {
  return ALL.filter((t): t is Extract<GalleryTemplate, { kind: K }> => t.kind === kind);
}
