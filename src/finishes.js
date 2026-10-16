// Named finishes: the materials and colours people pick from, each with a
// rendered swatch (assets/ui/swatches/<mat>-<id>.webp, made by
// tools/ui-pictures.mjs) and a one-line description. A custom colour is still
// possible; it simply has no name.

const G = (id, name, mat, items) => ({ id, name, mat, items: items.map(([fid, fname, color, tip]) => ({ id: fid, name: fname, mat, color, tip, group: id })) });

export const FINISH_GROUPS = [
  G('wood', 'Wood', 'wood', [
    ['light-oak', 'Light oak', '#d6b98f', 'Pale, even oak planks. Bright and calm.'],
    ['natural-oak', 'Natural oak', '#c49c70', 'Honey-toned oak with a soft grain.'],
    ['warm-oak', 'Warm oak', '#a98462', 'A deeper oak that grounds a room.'],
    ['walnut', 'Walnut', '#6f5039', 'Rich brown walnut, classic and warm.'],
    ['smoked-oak', 'Smoked oak', '#5a4636', 'Dark, smoky oak for a moody look.'],
    ['whitewashed', 'Whitewashed wood', '#e3d6c3', 'Limed boards, airy and coastal.'],
  ]),
  G('paint', 'Paint', 'paint', [
    ['warm-white', 'Warm white', '#efeae2', 'A soft white with a hint of cream.'],
    ['linen', 'Linen', '#e6dccb', 'Pale sand, gentle in every light.'],
    ['greige', 'Greige', '#d6c6b1', 'Between grey and beige, quietly warm.'],
    ['mushroom', 'Mushroom', '#bfae99', 'A deeper, earthy neutral for a feature wall.'],
    ['sage', 'Sage', '#a9b5a0', 'Muted green that feels restful.'],
    ['dusty-blue', 'Dusty blue', '#9fb2c2', 'Soft blue-grey, cool and calm.'],
    ['clay', 'Clay', '#c98368', 'Warm terracotta pink.'],
    ['deep-green', 'Deep green', '#3e4f45', 'Dark forest green for a cosy study.'],
    ['charcoal', 'Charcoal', '#3a3836', 'Near black, dramatic and modern.'],
  ]),
  G('tile', 'Tile', 'tile', [
    ['white-tile', 'White tile', '#f1efea', 'Glazed white squares with fine grout.'],
    ['sage-tile', 'Sage tile', '#a9b8a3', 'Soft green glazed tile.'],
    ['terracotta-tile', 'Terracotta tile', '#c98368', 'Warm clay tiles, Mediterranean.'],
    ['navy-tile', 'Navy tile', '#3b4a6b', 'Deep blue glaze, bold in a bathroom.'],
  ]),
  G('stone', 'Stone', 'stone', [
    ['white-marble', 'White marble', '#efebe4', 'Bright marble with soft grey veins.'],
    ['grey-marble', 'Grey marble', '#c9c7c3', 'Cool grey marble, polished.'],
    ['travertine', 'Travertine', '#d9c7a7', 'Warm beige stone, honed.'],
    ['black-marble', 'Black marble', '#2f2d2b', 'Dark marble with pale veins.'],
  ]),
  G('concrete', 'Concrete', 'concrete', [
    ['light-concrete', 'Light concrete', '#c9c4bc', 'Smooth pale concrete, matte.'],
    ['dark-concrete', 'Dark concrete', '#8a8781', 'Industrial grey concrete.'],
  ]),
  G('carpet', 'Carpet and rugs', 'carpet', [
    ['oatmeal-wool', 'Oatmeal wool', '#ddd3c2', 'A soft, natural wool weave.'],
    ['grey-wool', 'Grey wool', '#b9b6b0', 'Neutral grey wool.'],
    ['sage-wool', 'Sage wool', '#a9b8a3', 'Muted green wool.'],
    ['rust-wool', 'Rust wool', '#b8643c', 'Warm rust, a cosy accent.'],
  ]),
  G('fabric', 'Fabric', 'fabric', [
    ['oatmeal-linen', 'Oatmeal linen', '#d9cfbf', 'Natural linen, relaxed and light.'],
    ['ivory-boucle', 'Ivory bouclé', '#ebdcc4', 'Soft, nubby ivory weave.'],
    ['sage-velvet', 'Sage velvet', '#8d9a84', 'Muted green with a gentle sheen.'],
    ['slate-blue', 'Slate blue', '#6f7f9e', 'Calm blue-grey upholstery.'],
    ['mustard', 'Mustard', '#c99a2e', 'Warm golden yellow, mid-century.'],
    ['rust', 'Rust', '#b8643c', 'Burnt orange for a warm accent.'],
    ['charcoal-wool', 'Charcoal wool', '#4a4744', 'Dark, hard-wearing wool.'],
  ]),
  G('leather', 'Leather', 'leather', [
    ['cognac', 'Cognac leather', '#9a5a34', 'Warm brown leather that ages well.'],
    ['tan', 'Tan leather', '#b07a45', 'Lighter, saddle-coloured leather.'],
    ['chocolate', 'Chocolate leather', '#4a3224', 'Deep brown, classic.'],
    ['black-leather', 'Black leather', '#2b2a2a', 'Sleek black leather.'],
  ]),
  G('ceramic', 'Ceramic', 'ceramic', [
    ['white-glaze', 'White glaze', '#f7f6f2', 'Glossy white ceramic.'],
    ['clay-glaze', 'Clay glaze', '#c98368', 'Terracotta glaze.'],
    ['sage-glaze', 'Sage glaze', '#93a88f', 'Soft green glaze.'],
    ['charcoal-glaze', 'Charcoal glaze', '#3a3836', 'Dark glaze, almost black.'],
  ]),
  G('metal', 'Metal', 'metal', [
    ['brass', 'Brass', '#c9a45c', 'Warm brushed brass.'],
    ['brushed-steel', 'Brushed steel', '#b9bec5', 'Cool satin steel.'],
    ['black-metal', 'Black metal', '#2f2d2b', 'Matte black powder coat.'],
    ['chrome', 'Chrome', '#d8dbe0', 'Bright polished chrome.'],
  ]),
];
export const FINISHES = FINISH_GROUPS.flatMap((g) => g.items);
export const GROUP_BY_MAT = Object.fromEntries(FINISH_GROUPS.map((g) => [g.mat, g]));

// Woods and metals for legs, shells and frames (the second colour of a piece).
export const FRAME_FINISHES = ['light-oak', 'natural-oak', 'walnut', 'smoked-oak', 'brass', 'black-metal', 'brushed-steel', 'white-glaze']
  .map((id) => FINISHES.find((f) => f.id === id));

// Which material families suit each kind of target.
export const FAMILIES = {
  floor: ['wood', 'stone', 'tile', 'concrete', 'carpet'],
  wall: ['paint', 'tile', 'wood', 'stone', 'concrete'],
  item: ['fabric', 'leather', 'wood', 'paint', 'metal', 'ceramic', 'stone'],
};

export const swatchUrl = (f) => new URL(`../assets/ui/swatches/${f.mat}-${f.id}.webp`, import.meta.url).href;
// the named finish for a material and colour, if there is one
export const namedFinish = (mat, color) => FINISHES.find((f) => f.mat === mat && f.color.toLowerCase() === (color || '').toLowerCase()) || null;
export const frameNamed = (color) => FINISHES.find((f) => (f.group === 'wood' || f.group === 'metal' || f.group === 'ceramic') && f.color.toLowerCase() === (color || '').toLowerCase()) || null;
// second colours by kind: wood and metal frames, or fabrics for cushions and throws
export const secondFinishes = (kind) => (kind === 'fabric' ? GROUP_BY_MAT.fabric.items : FRAME_FINISHES);
