// Room templates: rooms laid out the way an interior designer would, as a
// starting point to build on. Each has one focal point, walking paths of at
// least 90 cm, rugs that the front legs of the seating stand on, three layers of
// light (overall, task, accent), a palette of one main colour, one secondary
// colour and a small accent, art hung at eye level, and decor in small groups.
// Layouts and palettes are our own.
//
// A template is plain data (no ids); templateRoom() makes a fresh room from it.
// Everything in it stays editable like any other room.
import { ROOM_TYPES } from './roomTypes.js';

// x runs along the back wall (N, z = 0), z towards the front; rot turns a piece
// (0 = facing the front). Wall items hang on a wall at `u` along it, centre `y`.
const I = (type, x, z, rot = 0, finish = null, frame = null) => ({ type, x, z, rot, ...(finish ? { finish } : {}), ...(frame ? { frame } : {}) });
const W = (type, wall, u, y, finish = null, frame = null) => ({ type, wall, u, y, ...(finish ? { finish } : {}), ...(frame ? { frame } : {}) });
const f = (mat, color) => ({ mat, color });
const PI = Math.PI;

export const TEMPLATES = [
  {
    id: 'living-warm-modern', type: 'living', name: 'Warm modern living room', style: 'Warm modern',
    blurb: 'Ivory and walnut around a mushroom feature wall, with a cognac leather reading chair.',
    atmosphere: 'golden-evening',
    // main: warm mushroom and ivory · secondary: walnut · accent: terracotta and cognac
    palette: ['#d6c6b1', '#e6dccb', '#6f5039', '#b8643c'],
    room: {
      width: 5.0, length: 4.5, height: 2.7, view: 'garden',
      openings: [
        { wall: 'N', type: 'door', offset: 4.35, width: 0.9, bottom: 0, height: 2.1 },
        { wall: 'W', type: 'window', offset: 1.15, width: 1.7, bottom: 0.55, height: 1.75 },
      ],
      finishes: {
        floor: f('wood', '#c49c70'),
        N: f('paint', '#d6c6b1'), // the feature wall behind the sofa
        S: f('paint', '#eee7dc'), W: f('paint', '#eee7dc'), E: f('paint', '#eee7dc'),
      },
      items: [
        // the conversation group on a large rug: sofa, coffee table, two chairs angled in
        I('rugLarge', 2.2, 1.55, 0, f('carpet', '#e2d8c6')),
        I('sofa', 2.2, 0.47, 0, f('fabric', '#ebdcc4')),
        I('oakCoffee', 2.2, 1.58, 0, f('wood', '#6f5039')),
        I('loungeChair2', 0.8, 1.8, PI / 2 + 0.32, f('leather', '#9a5a34'), '#4a3224'),
        I('woodArmchair', 3.2, 2.62, PI - 0.55, f('fabric', '#e4d5bf'), '#6f5039'),
        I('ottoman', 1.5, 2.42, 0.15, f('leather', '#b8643c'), '#2e2622'),
        // light: a globe over the group (overall), a reading lamp and a table lamp (task), wall lights framing the art (accent)
        I('pendantShort', 2.3, 2.05, 0, f('metal', '#d8dbe0')),
        I('lamp', 0.3, 1.0, 0, f('metal', '#2f2b28')),
        I('oakSide', 3.45, 0.3, 0, f('wood', '#6f5039')),
        W('sconce', 'N', 1.34, 1.52, f('metal', '#b8925a')), W('sconce', 'N', 3.06, 1.52, f('metal', '#b8925a')),
        // the focal point: one large print over the sofa, hung at eye level
        W('printLarge', 'N', 2.2, 1.42, f('paint', '#b8643c'), '#3a2b22'),
        // a shelf of books, baskets and vases with a small print beside it, plants in two corners
        I('cubeShelf', 0.2, 3.2, PI / 2, f('wood', '#7a5a40')),
        W('printSquare', 'W', 2.33, 1.42, f('paint', '#a88b6a')),
        I('plantMonstera', 0.42, 4.1),
        I('plantFig', 0.38, 0.36),
      ],
    },
  },
  {
    id: 'studio-japandi', type: 'studio', name: 'Japandi studio', style: 'Japandi',
    blurb: 'One open room in pale oak and linen: a sleeping corner behind a shelf, a kitchenette, a dining nook and a sofa by the window.',
    atmosphere: 'calm',
    // main: warm greige and linen · secondary: pale oak · accent: charcoal
    palette: ['#e8e1d6', '#d6b98f', '#c9bfae', '#3a3836'],
    room: {
      width: 8.0, length: 6.0, height: 2.8, view: 'garden',
      openings: [
        { wall: 'E', type: 'door', offset: 4.6, width: 0.9, bottom: 0, height: 2.1 },
        { wall: 'W', type: 'window', offset: 2.7, width: 1.6, bottom: 0.55, height: 1.85 },
        { wall: 'N', type: 'window', offset: 4.9, width: 1.0, bottom: 1.15, height: 1.0 },
      ],
      finishes: { floor: f('wood', '#d6b98f'), N: f('paint', '#e8e1d6'), S: f('paint', '#efeae2'), W: f('paint', '#efeae2'), E: f('paint', '#efeae2') },
      items: [
        // sleeping: the bed on a rug, a nightstand and lamp each side, an open shelf as a screen
        I('rugLarge', 1.5, 1.8, 0, f('carpet', '#e2dacb')),
        I('bed', 1.5, 1.09, 0, f('fabric', '#d2c8b8'), '#4a4744'),
        I('nightstand2', 0.33, 0.27, 0, f('wood', '#d9bf98')), I('nightstand2', 2.67, 0.27, 0, f('wood', '#d9bf98')),
        I('cubeShelf', 3.55, 1.3, PI / 2, f('wood', '#c9a77c')),
        W('printWide', 'N', 1.5, 1.62, f('paint', '#7f8a78'), '#2f2d2b'),
        // kitchenette along the back wall, a small round table for two
        I('sinkCounter', 4.9, 0.3, 0, f('paint', '#e3dccf')), I('stove', 5.8, 0.3, 0, f('metal', '#3a3836')),
        I('counter', 6.7, 0.3, 0, f('paint', '#e3dccf')), I('fridge', 7.65, 0.35, 0, f('metal', '#e7e5e1')),
        W('cabinet', 'N', 6.7, 1.9, f('wood', '#d6b98f')), W('clock', 'N', 3.75, 1.75, f('metal', '#3a3836')),
        I('rugRound', 6.0, 2.15, 0, f('carpet', '#cfc5b4')),
        I('dining', 6.0, 2.15, 0, f('wood', '#c9a77c')), I('pendant', 6.0, 2.15, 0, f('metal', '#d8dbe0')),
        I('woodChair', 5.19, 2.15, PI / 2, f('paint', '#3a3836')), I('woodChair', 6.81, 2.15, -PI / 2, f('paint', '#3a3836')),
        // living: sofa under a print framed by wall lights, a low table, a lounge chair, a reading lamp
        I('rugLarge', 1.65, 4.6, PI / 2, f('carpet', '#ddd3c2')),
        I('sofa', 0.47, 4.6, PI / 2, f('fabric', '#d9cfbf'), '#4a4744'),
        I('oakCoffee', 1.6, 4.6, PI / 2, f('wood', '#c9a77c')),
        I('loungeChair2', 2.95, 4.55, -PI / 2 - 0.3, f('leather', '#5b4a3c'), '#c9a77c'),
        I('lamp', 0.3, 3.25, 0, f('metal', '#3a3836')),
        I('pendantShort', 1.75, 4.6, 0, f('metal', '#d8dbe0')),
        W('printLarge', 'W', 4.6, 1.45, f('paint', '#8c7a63'), '#2f2d2b'),
        W('sconce', 'W', 3.83, 1.55, f('metal', '#3a3836')), W('sconce', 'W', 5.37, 1.55, f('metal', '#3a3836')),
        // plants: one beside the lounge chair, one in the corner by the door
        I('plantFig', 3.75, 5.6), I('plantMonstera', 7.6, 5.62),
      ],
    },
  },
  {
    id: 'bedroom-soft-minimal', type: 'bedroom', name: 'Soft minimal bedroom', style: 'Soft minimal',
    blurb: 'A quiet, layered bed in warm whites and stone, a clay throw, and a dresser under a tall print.',
    atmosphere: 'fresh-morning',
    // main: warm white · secondary: stone greige · accent: dusty clay
    palette: ['#efeae3', '#cdbfae', '#b9aa95', '#a8755d'],
    room: {
      width: 4.0, length: 3.8, height: 2.6, view: 'garden',
      openings: [
        { wall: 'E', type: 'door', offset: 3.2, width: 0.85, bottom: 0, height: 2.1 },
        { wall: 'W', type: 'window', offset: 1.9, width: 1.4, bottom: 0.7, height: 1.5 },
      ],
      finishes: { floor: f('wood', '#bf9b74'), N: f('paint', '#cdbfae'), S: f('paint', '#efeae3'), W: f('paint', '#efeae3'), E: f('paint', '#efeae3') },
      items: [
        // the bed is the focal point: centred on the feature wall, a long print above it
        I('rugLarge', 2.0, 1.85, 0, f('carpet', '#e9e2d6')),
        I('bed', 2.0, 1.09, 0, f('fabric', '#b9aa95'), '#a8755d'),
        I('nightstand2', 0.82, 0.27, 0, f('wood', '#e8e1d6')), I('nightstand2', 3.18, 0.27, 0, f('wood', '#e8e1d6')),
        W('printWide', 'N', 2.0, 1.56, f('paint', '#a8755d'), '#efeae3'),
        I('bench', 2.0, 2.45, 0, f('wood', '#a98763')),
        // a dresser under a tall print, a wall light beside them, a plant by the window
        I('dresser', 0.25, 3.2, PI / 2, f('wood', '#a98763')),
        W('printTall', 'W', 3.2, 1.55, f('paint', '#a3a08f'), '#cdb79a'),
        W('sconce', 'W', 2.76, 1.68, f('metal', '#b8925a')),
        I('plant', 0.3, 2.35, 0, f('ceramic', '#e3dcd2')),
        I('pendantShort', 2.0, 2.45, 0, f('metal', '#d8dbe0')),
      ],
    },
  },
  {
    id: 'bathroom-spa', type: 'bathroom', name: 'Organic spa bathroom', style: 'Organic spa',
    blurb: 'Stone and warm white with a pale oak vanity, a tub under the window and eucalyptus green touches.',
    atmosphere: 'bright-day',
    // main: warm stone · secondary: pale oak · accent: eucalyptus
    palette: ['#e6e0d6', '#d9d2c6', '#c9ab84', '#7f9a86'],
    room: {
      width: 2.8, length: 2.4, height: 2.5, view: 'garden',
      openings: [
        { wall: 'S', type: 'door', offset: 1.35, width: 0.8, bottom: 0, height: 2.05 },
        { wall: 'W', type: 'window', offset: 1.5, width: 1.0, bottom: 1.15, height: 0.9 },
      ],
      finishes: { floor: f('stone', '#d9d2c6'), N: f('tile', '#ece7df'), S: f('paint', '#efebe4'), W: f('tile', '#ece7df'), E: f('paint', '#efebe4') },
      items: [
        // the vanity and its mirror are the focal point, with a wall light each side
        I('vanity', 1.2, 0.25, 0, f('wood', '#c9ab84')),
        W('mirror', 'N', 1.2, 1.55, f('metal', '#b8925a')),
        W('sconce', 'N', 0.68, 1.6, f('metal', '#b8925a')), W('sconce', 'N', 1.72, 1.6, f('metal', '#b8925a')),
        // a walk-in shower in the far corner, the tub under the window, the toilet tucked to the side
        I('shower', 2.35, 0.45, -PI / 2, f('tile', '#e3ddd3')),
        I('bathtub', 0.4, 1.5, 0, f('ceramic', '#f7f6f2')), W('sconce', 'W', 0.45, 1.75, f('metal', '#b8925a')),
        I('toilet', 2.45, 1.95, -PI / 2, f('ceramic', '#f7f6f2')),
        I('bathmat', 1.1, 1.2, PI / 2, f('fabric', '#7f9a86')),
        I('plant', 2.5, 1.2, 0, f('ceramic', '#e9e4dc')),
        I('pendantShort', 1.4, 1.15, 0, f('metal', '#d8dbe0')),
      ],
    },
  },
  {
    id: 'kitchen-scandi', type: 'kitchen', name: 'Scandinavian kitchen', style: 'Scandinavian',
    blurb: 'White cabinetry and marble, a pale oak island with three stools under two globes, sage accents.',
    atmosphere: 'fresh-morning',
    // main: white · secondary: pale oak · accent: sage
    palette: ['#f5f3ef', '#cfae84', '#d9bd96', '#93a88f'],
    room: {
      width: 4.0, length: 3.8, height: 2.6, view: 'garden',
      openings: [
        { wall: 'E', type: 'door', offset: 1.1, width: 0.9, bottom: 0, height: 2.1 },
        { wall: 'N', type: 'window', offset: 3.12, width: 1.1, bottom: 1.15, height: 1.0 },
      ],
      finishes: { floor: f('wood', '#d9bd96'), N: f('tile', '#f1efea'), S: f('paint', '#f5f3ef'), W: f('paint', '#f5f3ef'), E: f('paint', '#f5f3ef') },
      items: [
        // a run of units along the back wall, sink under the window
        I('fridge', 0.37, 0.35, 0, f('metal', '#e9e8e4')), I('counter', 1.32, 0.3, 0, f('paint', '#f3f1ec')),
        I('stove', 2.22, 0.3, 0, f('metal', '#cfd2d6')), I('sinkCounter', 3.12, 0.3, 0, f('paint', '#f3f1ec')),
        W('cabinet', 'N', 1.32, 1.85, f('paint', '#f3f1ec')), W('clock', 'N', 2.22, 1.9, f('metal', '#d8dbe0')),
        // the island is the focal point: oak, three stools, two globes above
        I('runner', 2.1, 1.1, PI / 2, f('carpet', '#a9b8a3')),
        I('island', 2.1, 2.05, 0, f('wood', '#cfae84')),
        I('counterStool', 1.55, 2.73, PI, f('metal', '#93a88f')), I('counterStool', 2.1, 2.73, PI, f('metal', '#93a88f')), I('counterStool', 2.65, 2.73, PI, f('metal', '#93a88f')),
        I('pendantShort', 1.65, 2.05, 0, f('metal', '#d8dbe0')), I('pendantShort', 2.55, 2.05, 0, f('metal', '#d8dbe0')),
        // an open shelf and a print on the side wall, a wall light, a plant in the corner
        W('shelf', 'W', 1.25, 1.55, f('wood', '#cfae84')), W('printTall', 'W', 2.45, 1.5, f('paint', '#93a88f'), '#cfae84'),
        W('sconce', 'W', 1.25, 2.05, f('metal', '#b8925a')),
        I('plant', 0.32, 3.48, 0, f('ceramic', '#e6e1d8')),
      ],
    },
  },
  {
    id: 'dining-mid-century', type: 'dining', name: 'Mid-century dining room', style: 'Mid-century',
    blurb: 'A walnut table for four under a globe, a long sideboard and lamp, mustard art and candlelight.',
    atmosphere: 'cozy-night',
    // main: warm cream · secondary: walnut · accent: mustard
    palette: ['#efe6d6', '#6e4a30', '#d8c8ad', '#c99a2e'],
    room: {
      width: 4.4, length: 3.9, height: 2.7, view: 'garden',
      openings: [
        { wall: 'E', type: 'door', offset: 3.0, width: 0.9, bottom: 0, height: 2.1 },
        { wall: 'N', type: 'window', offset: 2.43, width: 2.0, bottom: 0.55, height: 1.85 },
      ],
      finishes: { floor: f('wood', '#b88c5e'), N: f('paint', '#e6d9c3'), S: f('paint', '#efe6d6'), W: f('paint', '#efe6d6'), E: f('paint', '#efe6d6') },
      items: [
        // the table under its globe is the focal point, all chair legs on the rug
        I('rugXL', 2.43, 1.85, 0, f('carpet', '#d6c5a5')),
        I('diningRect', 2.43, 1.85, 0, f('wood', '#6e4a30')),
        I('chair', 1.98, 1.1, 0, f('fabric', '#d8c8ad'), '#4a3224'), I('chair', 2.88, 1.1, 0, f('fabric', '#d8c8ad'), '#4a3224'),
        I('chair', 1.98, 2.6, PI, f('fabric', '#d8c8ad'), '#4a3224'), I('chair', 2.88, 2.6, PI, f('fabric', '#d8c8ad'), '#4a3224'),
        I('pendant', 2.43, 1.85, 0, f('metal', '#d8dbe0')),
        // a long sideboard with its lamp and decor, a large print above
        I('sideboard', 0.27, 1.85, PI / 2, f('wood', '#6e4a30')),
        W('printLarge', 'W', 1.85, 1.55, f('paint', '#c99a2e'), '#2b2622'),
        I('plantFig', 4.08, 0.35), I('plantMonstera', 0.42, 3.55),
      ],
    },
  },
  {
    id: 'office-moody', type: 'office', name: 'Moody modern study', style: 'Moody modern',
    blurb: 'A deep green wall of books, a walnut desk at the window and a cognac reading chair with its lamp.',
    atmosphere: 'bright-day',
    // main: deep green · secondary: walnut · accent: cognac and brass
    palette: ['#3e4f45', '#eee9e1', '#6b4a34', '#b07a45'],
    room: {
      width: 3.4, length: 3.2, height: 2.6, view: 'city',
      openings: [
        { wall: 'S', type: 'door', offset: 0.75, width: 0.85, bottom: 0, height: 2.1 },
        { wall: 'W', type: 'window', offset: 1.35, width: 1.2, bottom: 0.95, height: 1.3 },
      ],
      finishes: { floor: f('wood', '#a98462'), N: f('paint', '#3e4f45'), S: f('paint', '#eee9e1'), W: f('paint', '#eee9e1'), E: f('paint', '#eee9e1') },
      items: [
        // the wall of books is the focal point, a brass light between the cases
        I('bookcase', 2.0, 0.18, 0, f('wood', '#6b4a34')), I('bookcase', 2.92, 0.18, 0, f('wood', '#6b4a34')),
        W('sconce', 'N', 2.46, 2.12, f('metal', '#b8925a')),
        // a desk at the window on a rug, a print and plant beside it
        I('rug', 1.15, 1.35, PI / 2, f('carpet', '#cbbba3')),
        I('desk', 0.36, 1.35, PI / 2, f('wood', '#6b4a34')),
        I('taskChair', 1.05, 1.35, -PI / 2, f('leather', '#2e2a27')),
        W('printTall', 'W', 2.55, 1.5, f('paint', '#b07a45'), '#2b2622'),
        I('plantFig', 0.33, 0.33),
        // a reading corner: armchair and floor lamp
        I('woodArmchair', 2.75, 2.55, PI + 0.7, f('leather', '#b07a45'), '#6b4a34'),
        I('lamp', 3.15, 1.5, 0, f('metal', '#b8925a')),
        I('pendantShort', 1.75, 1.45, 0, f('metal', '#d8dbe0')),
      ],
    },
  },
];
export const TEMPLATE_BY_ID = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

// A fresh room (new ids) from a template's room data.
export function templateRoom(room, uid, name) {
  const r = structuredClone(room);
  return {
    id: uid(), name, type: r.type || 'living', width: r.width, length: r.length, height: r.height,
    openings: r.openings.map((o) => ({ id: uid(), ...o })),
    finishes: r.finishes,
    items: r.items.map((it) => ({ id: uid(), ...it })),
    view: r.view || 'garden', balcony: r.balcony || null,
  };
}

// Is this a name the app gave the room (a room type's or a template's name,
// maybe numbered), rather than one the user chose?
export function isDefaultRoomName(name) {
  const base = String(name || '').replace(/\s+\d+$/, '').trim().toLowerCase();
  return !base || Object.values(ROOM_TYPES).some((t) => t.name.toLowerCase() === base) || TEMPLATES.some((t) => t.name.toLowerCase() === base);
}
// Put a template's layout into an existing room. The room keeps its id, takes
// the template's type, and if it still has a default name, the name of that
// type (numbered if another room already has it). `taken`: other rooms' names.
export function applyTemplateTo(room, tpl, uid, taken = []) {
  const fresh = templateRoom({ type: tpl.type, ...tpl.room }, uid, room.name);
  Object.assign(room, { type: fresh.type, width: fresh.width, length: fresh.length, height: fresh.height, openings: fresh.openings, finishes: fresh.finishes, items: fresh.items, view: fresh.view, balcony: fresh.balcony });
  if (isDefaultRoomName(room.name)) {
    const base = ROOM_TYPES[room.type]?.name || room.name, names = new Set(taken);
    let name = base; for (let i = 2; names.has(name); i++) name = `${base} ${i}`;
    room.name = name;
  }
  delete room.style;
  return room;
}

// ---- my templates (saved in this browser) -----------------------------------------
const MINE_KEY = 'roomsmith:templates';
export function loadMyTemplates() { try { const v = JSON.parse(localStorage.getItem(MINE_KEY)); return Array.isArray(v) ? v : []; } catch { return []; } }
function saveMyTemplates(list) { try { localStorage.setItem(MINE_KEY, JSON.stringify(list)); return true; } catch { return false; } }
// a template from a room: its shape, finishes and pieces, without ids
export function roomAsTemplate(room, { name, blurb = '', atmosphere = null, thumb = null }, uid) {
  const strip = ({ id, ...rest }) => rest;
  return {
    id: 'mine-' + uid(), mine: true, type: room.type, name, blurb, atmosphere, thumb,
    room: { width: room.width, length: room.length, height: room.height, view: room.view, balcony: room.balcony ? structuredClone(room.balcony) : null,
      openings: room.openings.map(strip), finishes: structuredClone(room.finishes), items: room.items.map(strip) },
  };
}
export function addMyTemplate(tpl) { const list = loadMyTemplates(); list.unshift(tpl); return saveMyTemplates(list) ? list : null; }
export function removeMyTemplate(id) { const list = loadMyTemplates().filter((t) => t.id !== id); saveMyTemplates(list); return list; }
