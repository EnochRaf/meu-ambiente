// What is in the photo? Categories carry typical real sizes (cm), the catalog
// piece that matches, and a default material. A small ImageNet classifier
// (transformers.js, loaded on demand) suggests a category; a shape heuristic
// covers the rest.
const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';
export const CLASSIFIER = { id: 'Xenova/clip-vit-base-patch32', dtype: 'q8', size: '90 MB' };
export const PROMPTS = Object.fromEntries([['sofa', 'a sofa'], ['armchair', 'an armchair'], ['chair', 'a dining chair'], ['table', 'a table'], ['coffee', 'a coffee table'], ['bed', 'a bed'], ['storage', 'a cabinet or bookshelf'], ['lamp', 'a lamp'], ['plant', 'a potted plant'], ['appliance', 'a kitchen appliance'], ['rug', 'a rug'], ['painting', 'a framed painting'], ['mirror', 'a mirror'], ['shelf', 'a wall shelf']].map(([id, t]) => [id, `a photo of ${t}`]));

export const CATEGORIES = [
  { id: 'sofa', name: 'Sofa', kind: 'floor', size: [200, 90, 85], match: 'sofa', mat: 'fabric', labels: [/couch|sofa|loveseat/i] },
  { id: 'armchair', name: 'Armchair', kind: 'floor', size: [90, 90, 85], match: 'armchair', mat: 'fabric', labels: [/rocking chair|barber chair|throne|armchair/i] },
  { id: 'chair', name: 'Chair', kind: 'floor', size: [48, 50, 90], match: 'chair', mat: 'wood', labels: [/folding chair|chair/i] },
  { id: 'table', name: 'Table', kind: 'floor', size: [120, 70, 75], match: 'dining', mat: 'wood', labels: [/dining table|desk|table/i] },
  { id: 'coffee', name: 'Coffee table', kind: 'floor', size: [110, 60, 42], match: 'coffee', mat: 'wood', labels: [/coffee table/i] },
  { id: 'bed', name: 'Bed', kind: 'floor', size: [160, 210, 90], match: 'bed', mat: 'fabric', labels: [/four-poster|bed|crib|cradle|quilt/i] },
  { id: 'storage', name: 'Cabinet or shelves', kind: 'floor', size: [90, 40, 180], match: 'bookcase', mat: 'wood', labels: [/wardrobe|bookcase|bookshop|chiffonier|china cabinet|cabinet|chest/i] },
  { id: 'lamp', name: 'Lamp', kind: 'floor', size: [40, 40, 160], match: 'lamp', mat: 'metal', labels: [/lamp|lampshade/i] },
  { id: 'plant', name: 'Plant', kind: 'floor', size: [50, 50, 120], match: 'plant', mat: 'ceramic', labels: [/pot\b|flowerpot|vase|daisy|plant|tree|leaf/i] },
  { id: 'appliance', name: 'Appliance', kind: 'floor', size: [70, 70, 180], match: 'fridge', mat: 'metal', labels: [/refrigerator|icebox|stove|dishwasher|washer|microwave/i] },
  { id: 'rug', name: 'Rug', kind: 'rug', size: [200, 140, 2], match: 'rug', mat: 'carpet', labels: [/rug|doormat|mat\b/i] },
  { id: 'painting', name: 'Painting or print', kind: 'wall', size: [80, 60, 4], match: 'art', mat: 'paint', hang: 1.5, labels: [/book jacket|comic book|envelope|jigsaw|poster/i] },
  { id: 'mirror', name: 'Mirror', kind: 'wall', size: [50, 90, 3], match: 'mirror', mat: 'metal', hang: 1.6, labels: [/mirror/i] },
  { id: 'shelf', name: 'Wall shelf', kind: 'wall', size: [90, 25, 25], match: 'shelf', mat: 'wood', hang: 1.6, labels: [/shelf|plate rack/i] },
  { id: 'other-floor', name: 'Something else on the floor', kind: 'floor', size: [80, 40, 80], match: null, mat: 'fabric', labels: [] },
  { id: 'other-wall', name: 'Something else on a wall', kind: 'wall', size: [60, 40, 5], match: null, mat: 'paint', hang: 1.5, labels: [] },
];
export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

export function categoryFromLabels(labels, minScore = 0.3) {
  const best = labels[0];
  if (best?.id && best.score >= minScore) return best.id;
  for (const { label } of labels) for (const c of CATEGORIES) if (c.labels.some((re) => re.test(label))) return c.id;
  return null;
}

// aspect = width / height of the cutout
export function guessByShape(aspect) {
  if (aspect > 1.7) return 'sofa';
  if (aspect < 0.45) return 'lamp';
  if (aspect < 0.8) return 'plant';
  return 'armchair';
}

// Pick a material family from the photo's colours: shiny greys read as metal,
// dark warm browns as leather, saturated colours as fabric.
export function guessMaterial(category, color) {
  const [r, g, b] = color;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), sat = max ? (max - min) / max : 0, lum = (r + g + b) / 3;
  if (category.kind === 'wall') return category.mat;
  if (category.id === 'lamp' || category.id === 'appliance') return sat < 0.12 ? 'metal' : category.mat;
  if (category.id === 'table' || category.id === 'coffee' || category.id === 'chair' || category.id === 'storage') return sat > 0.12 && r > g && g > b ? 'wood' : category.mat;
  if ((category.id === 'sofa' || category.id === 'armchair') && sat > 0.2 && r > g && g >= b && lum < 120) return 'leather';
  return category.mat;
}

let loading = null;
// Zero-shot: score the cutout against one prompt per category. Runs on WASM.
export function loadClassifier(onProgress = () => {}) {
  if (loading) return loading;
  loading = (async () => {
    const tf = await import(/* @vite-ignore */ TRANSFORMERS);
    const progress_callback = (p) => { if (p.status === 'progress' && p.total) onProgress(Math.min(1, p.loaded / p.total)); };
    const pipe = await tf.pipeline('zero-shot-image-classification', CLASSIFIER.id, { dtype: CLASSIFIER.dtype, device: 'wasm', progress_callback });
    const ids = Object.keys(PROMPTS), texts = ids.map((id) => PROMPTS[id]);
    return {
      // -> [{ id, label, score }] best first
      async classify(canvas) {
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
        const image = await tf.RawImage.fromBlob(blob);
        const res = await pipe(image, texts);
        return res.map((r) => ({ id: ids[texts.indexOf(r.label)], label: r.label.replace('a photo of ', ''), score: r.score })).sort((a, b) => b.score - a.score);
      },
    };
  })();
  loading.catch(() => { loading = null; });
  return loading;
}
