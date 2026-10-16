// The home Meu Ambiente opens with: a furnished, styled living room in our soft
// modern look, so the first view already shows what the editor can do.
// A long sofa wall, a low sideboard under a wide picture window, a reading
// corner, a round dining table under a globe pendant, plants, art and lamps.
export function starterLivingRoom(uid) {
  const W = 6.4, L = 5.2;
  const it = (type, x, z, rot = 0, extra = {}) => ({ id: uid(), type, x, z, rot, ...extra });
  return {
    id: uid(), name: 'Living room', type: 'living', width: W, length: L, height: 2.7,
    openings: [
      { id: uid(), wall: 'N', type: 'door', offset: 0.85, width: 0.9, bottom: 0, height: 2.1 },
      { id: uid(), wall: 'W', type: 'window', offset: 2.45, width: 2.4, bottom: 0.62, height: 1.75 },
    ],
    finishes: {
      floor: { mat: 'wood', color: '#cfae86' },
      N: { mat: 'paint', color: '#efe9df' }, S: { mat: 'paint', color: '#efe9df' }, W: { mat: 'paint', color: '#e8e1d6' }, E: { mat: 'paint', color: '#efe9df' },
    },
    items: [
      it('rug', 3.75, 2.15), it('sofa', 3.75, 0.47), it('oakCoffee', 3.75, 1.85),
      it('loungeChair2', 5.45, 2.35, -Math.PI / 2 + 0.35), it('woodArmchair', 2.15, 2.55, Math.PI / 2 - 0.2),
      it('oakSide', 5.12, 0.4), it('lamp', 2.45, 0.32), it('cubeShelf', 5.95, 0.4, 0),
      it('sideboard', 0.36, 2.45, Math.PI / 2), it('plantMonstera', 0.5, 4.25), it('plantFig', 0.45, 0.5),
      it('dining', 4.3, 4.05), it('pendant', 4.3, 4.05),
      it('chair', 4.3, 3.39), it('chair', 4.3, 4.71, Math.PI), it('chair', 3.64, 4.05, Math.PI / 2), it('chair', 4.96, 4.05, -Math.PI / 2),
      it('ottoman', 4.95, 2.98, 0.3), it('lamp', 5.97, 1.5),
      { id: uid(), type: 'frameWide', wall: 'N', u: 3.75, y: 1.62 }, { id: uid(), type: 'frameSmall', wall: 'N', u: 5.95, y: 1.75 },
      { id: uid(), type: 'frameTall', wall: 'W', u: 4.45, y: 1.45 },
    ],
    view: 'garden', balcony: null,
  };
}
