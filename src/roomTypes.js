// Room presets: starting size, openings, finishes and which catalog items show.
export const ROOM_TYPES = {
  living: {
    name: 'Living room', blurb: 'Sofa, tables and shelves', size: [5, 4, 2.6],
    openings: [['N', 'door', 1.0], ['W', 'window', 2.2]],
    finishes: { floor: { mat: 'wood', color: '#c8a378' }, wall: { mat: 'paint', color: '#f3efe7' } },
    catalog: ['sofa', 'loungeChair2', 'woodArmchair', 'armchair', 'oakCoffee', 'roundCoffee', 'oakSide', 'sideboard', 'cubeShelf', 'tv', 'bookcase', 'shelf', 'rug', 'rugRound', 'lamp', 'plantMonstera', 'plantFig', 'plant', 'frameWide', 'frameTall', 'frameSmall', 'art', 'sconce', 'pendant', 'pendantShort', 'ottoman', 'dining', 'chair', 'rugLarge', 'rugXL', 'printLarge', 'printTall', 'printSquare', 'printWide', 'clock'],
  },
  bedroom: {
    name: 'Bedroom', blurb: 'Bed, wardrobe and nightstands', size: [4, 3.6, 2.6],
    openings: [['N', 'door', 0.8], ['W', 'window', 1.8]],
    finishes: { floor: { mat: 'carpet', color: '#d8cfc2' }, wall: { mat: 'paint', color: '#efe9e0' } },
    catalog: ['bed', 'nightstand2', 'nightstand', 'wardrobe', 'dresser', 'bench', 'woodArmchair', 'armchair', 'rugLarge', 'rug', 'rugRound', 'lamp', 'pendantShort', 'plantFig', 'plant', 'printWide', 'printTall', 'art', 'mirror', 'shelf', 'sconce'],
  },
  bathroom: {
    name: 'Bathroom', blurb: 'Tub, shower, toilet and sink', size: [2.6, 2.3, 2.5],
    openings: [['N', 'door', 0.7], ['W', 'window', 1.4, 1.4, 0.6]],
    finishes: { floor: { mat: 'tile', color: '#dfe5e8' }, wall: { mat: 'tile', color: '#eef1f3' } },
    catalog: ['bathtub', 'shower', 'toilet', 'vanity', 'mirror', 'cabinet', 'bathmat', 'plant', 'sconce', 'shelf', 'pendantShort', 'printSquare'],
  },
  kitchen: {
    name: 'Kitchen', blurb: 'Counters, fridge, stove and island', size: [4.2, 3.6, 2.6],
    openings: [['N', 'door', 0.8], ['W', 'window', 2.0]],
    finishes: { floor: { mat: 'tile', color: '#d9d2c6' }, wall: { mat: 'paint', color: '#f4f1ea' } },
    catalog: ['counter', 'sinkCounter', 'stove', 'fridge', 'island', 'counterStool', 'cabinet', 'dining', 'chair', 'woodChair', 'pendant', 'pendantShort', 'runner', 'clock', 'plant', 'shelf', 'printTall'],
  },
  office: {
    name: 'Office', blurb: 'Desk, chair and storage', size: [3.6, 3.2, 2.6],
    openings: [['N', 'door', 0.8], ['W', 'window', 1.6]],
    finishes: { floor: { mat: 'wood', color: '#b89468' }, wall: { mat: 'paint', color: '#e9edf0' } },
    catalog: ['desk', 'taskChair', 'bookcase', 'filing', 'shelf', 'plantFig', 'plant', 'lamp', 'pendantShort', 'printTall', 'printSquare', 'art', 'woodArmchair', 'armchair', 'rug', 'sconce', 'clock'],
  },
  dining: {
    name: 'Dining room', blurb: 'Table, chairs and a sideboard', size: [4.2, 3.6, 2.7],
    openings: [['E', 'door', 2.9], ['N', 'window', 2.1, 1.8, 0.6]],
    finishes: { floor: { mat: 'wood', color: '#b88c5e' }, wall: { mat: 'paint', color: '#efe6d6' } },
    catalog: ['diningRect', 'dining', 'chair', 'woodChair', 'sideboard', 'pendant', 'pendantShort', 'rugXL', 'rugLarge', 'rugRound', 'printLarge', 'printWide', 'sconce', 'plantFig', 'plantMonstera', 'lamp', 'clock'],
  },
  studio: {
    name: 'Studio apartment', blurb: 'Living, sleeping and cooking in one', size: [8, 6, 2.8],
    openings: [['E', 'door', 4.6], ['W', 'window', 2.7, 1.6, 0.55], ['N', 'window', 4.9, 1.0, 1.15]],
    finishes: { floor: { mat: 'wood', color: '#d6b98f' }, wall: { mat: 'paint', color: '#efeae2' } },
    catalog: ['sofa', 'loungeChair2', 'woodArmchair', 'oakCoffee', 'oakSide', 'bed', 'nightstand2', 'cubeShelf', 'sideboard', 'counter', 'sinkCounter', 'stove', 'fridge', 'cabinet', 'dining', 'woodChair', 'chair', 'rugLarge', 'rugXL', 'rugRound', 'lamp', 'pendant', 'pendantShort', 'sconce', 'plantFig', 'plantMonstera', 'printLarge', 'printWide', 'printTall', 'clock'],
  },
  empty: {
    name: 'Empty room', blurb: 'Blank walls, whole catalog', size: [4, 4, 2.6],
    openings: [['N', 'door', 1.0]],
    finishes: { floor: { mat: 'wood', color: '#c8a378' }, wall: { mat: 'paint', color: '#f3efe7' } },
    catalog: null, // everything
  },
};
export const ROOM_TYPE_IDS = Object.keys(ROOM_TYPES);

export function roomTypeOf(type) { return ROOM_TYPES[type] || ROOM_TYPES.living; }

// Opening tuples are [wall, type, offset, width?, sill?] for compactness.
export function templateOpenings(type, uid) {
  return roomTypeOf(type).openings.map(([wall, kind, offset, width, sill]) => kind === 'door'
    ? { id: uid(), wall, type: 'door', offset, width: width || 0.9, bottom: 0, height: 2.1 }
    : { id: uid(), wall, type: 'window', offset, width: width || 1.4, bottom: sill ?? 0.9, height: 1.2 });
}

export function templateFinishes(type) {
  const t = roomTypeOf(type);
  return { floor: { ...t.finishes.floor }, N: { ...t.finishes.wall }, S: { ...t.finishes.wall }, W: { ...t.finishes.wall }, E: { ...t.finishes.wall } };
}
