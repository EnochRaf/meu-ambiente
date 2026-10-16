// Interior style presets: one click sets the floor, the walls and the colour of
// every material family used by the furniture. Materials keep their type.
export const STYLES = [
  { id: 'scandi', name: 'Scandinavian', blurb: 'Pale wood, white walls, soft greys',
    floor: { mat: 'wood', color: '#e2d2b4' }, wall: { mat: 'paint', color: '#f6f3ed' },
    palette: { fabric: '#cfc9bf', leather: '#b89a7a', wood: '#d9c3a0', metal: '#d8d8d4', paint: '#f1ede4', ceramic: '#f7f6f2', carpet: '#e4ded3', tile: '#ebe9e3', stone: '#d9d6cf', concrete: '#d3d1cb' } },
  { id: 'industrial', name: 'Industrial', blurb: 'Concrete, dark steel, worn leather',
    floor: { mat: 'concrete', color: '#9a9690' }, wall: { mat: 'concrete', color: '#c9c4bc' },
    palette: { fabric: '#4c4f55', leather: '#6b4a32', wood: '#6f5438', metal: '#2e3136', paint: '#5a5d63', ceramic: '#e9e6e0', carpet: '#5f5a55', tile: '#8f8c86', stone: '#7d7a74', concrete: '#9a9690' } },
  { id: 'coastal', name: 'Coastal', blurb: 'Whitewash, sea blue, sand',
    floor: { mat: 'wood', color: '#efe6d2' }, wall: { mat: 'paint', color: '#f7fafc' },
    palette: { fabric: '#9fc0d4', leather: '#d8c1a3', wood: '#e6d8bf', metal: '#e4e7ea', paint: '#eef4f7', ceramic: '#ffffff', carpet: '#d9cdb6', tile: '#e8eef1', stone: '#dcd7cb', concrete: '#d5d9db' } },
  { id: 'boho', name: 'Boho', blurb: 'Terracotta, rattan, mustard',
    floor: { mat: 'wood', color: '#c99a68' }, wall: { mat: 'paint', color: '#f3e7d6' },
    palette: { fabric: '#c9743f', leather: '#a56b3e', wood: '#b88653', metal: '#8a6b3f', paint: '#eadbc3', ceramic: '#e9d9c2', carpet: '#d7a85a', tile: '#e5d4bd', stone: '#c9b79c', concrete: '#cdbba1' } },
  { id: 'minimal', name: 'Minimal', blurb: 'White, black, nothing extra',
    floor: { mat: 'stone', color: '#e9e9e7' }, wall: { mat: 'paint', color: '#fbfbfb' },
    palette: { fabric: '#dadada', leather: '#1f1f1f', wood: '#f0ebe2', metal: '#1f1f1f', paint: '#f4f4f4', ceramic: '#ffffff', carpet: '#e6e6e4', tile: '#f1f1ef', stone: '#e9e9e7', concrete: '#dcdcda' } },
];
export const STYLE_BY_ID = Object.fromEntries(STYLES.map((s) => [s.id, s]));

// Apply a style to one room, in place. `defs` gives each item's default material.
export function applyStyle(room, style, defs) {
  room.finishes.floor = { ...style.floor };
  for (const k of ['N', 'S', 'W', 'E']) room.finishes[k] = { ...style.wall };
  for (const it of room.items) {
    const def = defs[it.type];
    if (!def) continue;
    const mat = (it.finish || def.finish).mat;
    const color = style.palette[mat];
    if (color) it.finish = { mat, color };
  }
  room.style = style.id;
  return room;
}
