export type Audience = "women" | "men";
export type Category = "Recommended" | "Lingerie" | "Casual" | "Event" | "Streetwear";

export type PresetLook = {
  id: string;
  title: string;
  imageSrc: string;
};

const LOOKS_BASE = "/looks";

function lookPath(audience: Audience, category: Category, filename = "placeholder.svg") {
  // Folder naming matches `public/looks/<audience>/<category>/...`
  // Category folders are lowercase with spaces removed (e.g., "Recommended" -> "recommended").
  return `${LOOKS_BASE}/${audience}/${category.toLowerCase().replaceAll(" ", "")}/${filename}`;
}

// Deprecated: the static manifest is retained only as a type reference.
// The live gallery now loads files dynamically from `public/looks/...` via an API route.
export const PRESET_LOOKS: Record<Audience, Record<Category, PresetLook[]>> = {} as any;

