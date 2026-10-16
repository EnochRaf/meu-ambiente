# Meu Ambiente: development notes

How the app works and where things are. The short version is in the README.

- `npm start` serves the source at http://127.0.0.1:8765/ with `scripts/serve.mjs` (plain static files, no dependencies).
- `npm run build` copies the site into `dist/` and checks every module import resolves;
  `npm run preview` builds and serves `dist/` at the same address.
- `npm test` runs the node tests: placement rules, catalog builders, room
  presets, templates, translations, window views and project sanitizing.
- `node tools/smoke.mjs http://127.0.0.1:8765/` runs the browser checks (needs
  `npm install` and Chrome; set `CHROME=/path/to/chrome` if it is not found).

## Features

- Room templates: seven furnished rooms to start from, each in its own style,
  size and default atmosphere: Warm modern living room (5 × 4.5 m), Japandi
  studio (8 × 6 m, sleeping, kitchenette, dining nook and living zones), Soft
  minimal bedroom, Organic spa bathroom, Scandinavian kitchen with an island,
  Mid-century dining room and Moody modern study. Each has one focal point,
  walking paths of at least 90 cm, rugs under the front legs of the seating,
  overall, task and accent light, and a main, secondary and accent colour
  (tests check the fit, the paths and the rugs). "Add a room" offers a gallery
  of rendered thumbnails or an empty room; "Templates" applies one to the
  current room (after a confirmation; Undo brings the room back); "Save as
  template" keeps the current room, with a picture, under My templates.
- Pieces with a separate frame (dining chair legs, lounge chair shell, prints'
  mouldings, the bed's throw, sofa cushions) take a second colour.
- Opens on a furnished, styled living room (CC0 furniture and decor from
  Poly Haven plus our own pieces), in a Golden evening light.
- Quality-first rendering: ACES filmic colour, soft sun shadows (4096 map),
  live ambient occlusion at full resolution, a fill and a rim light, studio
  reflections, lamp light, glow and soft lamp shadows, gentle depth of field
  that keeps the room sharp, soft fog, MSAA + SMAA and supersampling, and a
  colour grade per atmosphere. A 26° lens; the camera glides into view for a
  few seconds when the page opens, then rests. While it rests, 32 jittered
  frames (sub-pixel offsets, a sun nudged within its disc, rotated lamp-shadow
  filters) are averaged into one refined picture with the smoothest edges and
  softest shadows, and then nothing more is drawn until something changes.
  A "Drift when idle" switch (off by default) brings back a slow camera drift
  after a while without input. If frames drop below 30 per second while
  moving, quality steps down on its own (render scale, lamp-shadow taps,
  reflections, occlusion samples, depth of field, MSAA, and finally lamp
  shadows in moving frames only) and steps back up when there is room. High
  is the default.
- Floors and tiled walls are laid out in the shader: planks, tiles and slabs
  with crisp anti-aliased seams, bevelled edges and per-board variation;
  mirror reflections sharp on tile and stone, softer on wood.
- Photo-scanned CC0 textures (wood veneer, plaster, linen, leather, wool,
  concrete) tinted by our own colours; see ASSETS.md.
- Atmospheres: Fresh morning, Bright day, Calm, Golden evening and Cozy night.
  One click sets the time of day, the lamp level, the warmth of the light, the
  backdrop palette and the colour grade together. A Lamps slider (Off to
  Bright, or Auto to follow the daylight) sits under the daylight slider.
- Lamps light the room with a soft lamp field of our own (no three.js lights):
  light falls off smoothly to each lamp's reach, pools under shades, catches
  glossy surfaces, and costs the same however many lamps there are. Shades
  warm up and get a soft halo as the lamps come on.
- The room stands on a light, rounded plinth with a soft two-layer shadow.
- A soft, blurred backdrop behind the room: a gentle gradient with soft light
  that shifts colour with the time of day. No geometry, almost no cost.
- The room as a model: a floor slab, thick walls with a clean cut top, skirting
  boards, lined door and window openings with architraves, panelled doors with
  lever handles, framed windows with glass, inner and outer sills, and curtains
  on a rod. A soft shadow sits under the whole model.
- Window views per room (Garden, Ocean, City or None): real CC0 panoramic
  photos, slightly out of focus as in a photo of the room. Each view has a
  day, sunset and night photo (lights on at night) that cross-fade with the
  time of day. The photo sits on a large sphere around the room, so it shifts
  with gentle parallax as the camera moves; the main window faces the best
  part of it. The glass carries a faint reflection, and frames and curtains
  stay in front. The picker shows each view at the current hour.
- An optional balcony on any wall (width, depth, glass/metal/concrete railing,
  wood/tile/concrete floor) with a glass door, and a Balcony tab of outdoor
  furniture placed with the same rules as indoors.
- Polished floors reflect furniture, lamps and windows; how much depends on the
  material (tile and stone most, wood softly, carpet and paint not at all) and
  on each pixel's gloss, so grout and seams stay matt. Reflections are sharp
  where a leg meets the floor and soften with distance. A small studio
  environment, rebuilt as the light changes, adds soft highlights.
- Quality setting (Low/Medium/High): pixel ratio while moving and when still,
  number of refinement samples, shadow resolution, ambient occlusion, floor
  reflections and texture size.
- Every lamp casts soft shadows: each lamp renders the room's distances into a
  small cube when the furniture or lamps change; the cubes are unfolded into
  one octahedral atlas that every material reads, with a blocker search so
  shadows are crisp at contact and softer further away. Bigger glowing parts
  (a globe pendant) give softer shadows than a small shade.

- Interface ("side drawer"): a slim rail on the left with one labelled place
  for each task (Rooms, Furniture, Materials, Atmosphere, plus Settings and
  Help) opens one drawer at a time beside the room; clicking the open task
  again, the collapse button or `[` folds the panel to the rail; Full view
  (or `\\`) hides everything but the room, with a Show panels button (or Esc)
  to bring it back. The view glides to centre on the space that is left, and
  the state is remembered. Every choice is a picture: furniture as large renders of the
  real models with name and size; materials as rendered swatches with names
  ("Light oak", "White marble", "Oatmeal linen"); atmospheres as small
  renders of your own room in each light; templates as rendered thumbnails
  with a one-line description; room sizes as floor plans with dimensions;
  styles as previews of a furnished room; window views as the view itself.
  Resting the pointer on any choice (or a long press on touch) shows a short
  description. Selecting a piece, wall or the floor shows a small toolbar
  beside it (Turn, Copy, Material, Edit, Remove); it hides when nothing is
  selected. Advanced room settings (exact size, doors and windows, balcony)
  stay folded until needed. Drag the pebbles at the walls to resize the room;
  drag doors and windows from Rooms › Walls, doors, windows and balcony onto
  a wall.
- Languages: Brazilian Portuguese (the default) and English, in Settings and
  with a PT/EN toggle in the top bar; remembered. Everything is translated:
  buttons, menus, tooltips, the tour, furniture, materials, templates,
  atmospheres, room types, sizes, messages and credits, with local number
  formats (5,0 × 4,5 m). All text lives in `src/i18n/<language>.json`; to add
  a language, add a file with the same keys and a line to `LANGUAGES` in
  `src/i18n/index.js` (a test checks every key and placeholder). Rooms with
  a default name show it in the current language.
- Light and dark interface: Light, Dark or Automatic (follows the computer;
  the default) in Settings, plus a quick toggle in the top bar; remembered.
  Dark is our own warm charcoal with the same frosted glass and green. Only
  the interface changes; the 3D room keeps its own look.
- Style presets (Scandinavian, Industrial, Coastal, Boho, Minimal) recolour
  floor, walls and every piece together.
- Rendering: soft sun shadows from a jittered sun, ambient occlusion, contact
  shadows under furniture, warm pools of lamp light and a gentle glow at
  night, a colour grade per time of day, detailed procedural furniture.

- Room types (living room, bedroom, bathroom, kitchen, office, empty) with a
  starting size, openings, finishes and a filtered furniture catalog.
- Floor and wall placement with overlap rules, door clearance, grid and
  wall snapping, and nearest-fit search.
- Time-of-day lighting (morning, midday, evening, night) with shadows that
  pass through windows and doors; lamps and wall lights glow at night.
- Finish editor: click the floor, a wall or a piece and pick a material
  (paint, wood, tile, stone, concrete, carpet, fabric, leather, ceramic,
  metal) and a colour. Textures are generated procedurally.
- Photo items: a three-step dialog. Photo (tips and kind warnings about small,
  blurry or slanted shots), Cutout (quick region-growing cutout or an on-device
  AI model, straighten, erase/restore brushes, crop, automatic trim, eroded and
  feathered edges with colour defringing), Size and preview (what it is, typical
  real dimensions, photo proportions kept, a 170 cm person for scale, a choice
  between the extruded photo cutout and a matched catalog piece recoloured from
  the photo's main colour). Floor items stand on the floor with a soft contact
  shadow and a footprint of their real width and depth; wall items hang at a
  sensible height. The cutout has real thickness with sides and back coloured
  from the photo. Saved in IndexedDB.
- AI models (downloaded only when asked, cached by the browser): BiRefNet lite
  (MIT, WebGPU, 115 MB) with U²-Net-p (Apache 2.0, 4.6 MB, WASM, served with
  the app) as the fallback for the cutout, and CLIP ViT-B/32 (MIT, zero-shot,
  about 90 MB) for "Detect". Everything runs locally; nothing is uploaded.
- Undo/redo with Cmd+Z and Shift+Cmd+Z (Ctrl on Windows and Linux).
- Layouts autosave to localStorage. "Copy share link" puts the whole project
  in the URL fragment (`#p=…`, deflate + base64url). Photo items stay on the
  device that created them, so a shared link only shows them there.

## Layout

- `src/placement.js` pure placement rules (tested)
- `src/state.js` project model, store, autosave, share links (tested)
- `src/roomTypes.js` room presets (tested)
- `src/materials.js` material list and procedural textures
- `src/cutout.js` background removal, feathering, silhouette extrusion (tested)
- `src/customItems.js` photo items: IndexedDB store, cutout pipeline, catalog builder
- `src/photoDialog.js` the three-step photo dialog
- `src/segment.js` on-device AI background removal
- `src/classify.js` categories with typical sizes, CLIP detection, material guess
- `src/catalog.js` furniture definitions and procedural shapes (tested)
- `src/scene.js` three.js scene, lighting, picking, highlights
- `src/interaction.js` drag, select, rotate, delete
- `src/ui.js` the rail and drawer, the toolbar beside the selection, actions, tour
- `src/ui/` the drawers (`rooms.js`, `furniture.js`, `materials.js`, `atmosphere.js`, `settings.js`), the template gallery (`gallery.js`), drawn pictures (`pictures.js`), descriptions and DOM helpers
- `src/i18n/` the language files (`en.json`, `pt-BR.json`), `t()` and number formats (`index.js`), and names of things (`names.js`)
- `src/finishes.js` named finishes ("Light oak", "White marble"…) with their swatches
- `assets/ui/` rendered swatches and style previews (`tools/ui-pictures.mjs` rebuilds them)
- `src/styles.js` interior style presets (tested)
- `src/thumbs.js` offscreen thumbnail renderer
- `src/balcony.js` balcony frame, fit rules, door and starter furniture (tested)
- `src/roomModel.js` the room shell: walls, trims, openings, curtains, balcony
- `src/look.js` time-of-day looks, the backdrop and the studio environment
- `src/views.js` the window views: photo loading, the glass shader (projection, parallax, time blend, reflection)
- `assets/views/` the window view photos (`tools/views.mjs` rebuilds them from Poly Haven HDRIs)
- `src/reflect.js` planar floor reflection (gloss-weighted, contact-sharp)
- `src/lamps.js` the lamp field: soft lamp light and lamp shadows injected into our materials
- `src/lampShadows.js` renders each lamp's distance cube into the shared shadow atlas
- `src/atmospheres.js` the five atmospheres and how they change the look
- `src/layout.js` planks, tiles and slabs drawn in the shader
- `src/models.js` CC0 model loading, placement and tinting
- `src/dof.js` depth of field pass
- `src/starter.js` the furnished home Meu Ambiente opens with
- `src/templates.js` the room templates, applying them, and My templates (localStorage `roomsmith:templates`)
- `assets/` CC0 models and textures (`tools/assets.mjs` rebuilds them)
- `src/grade.js` colour grade pass
- `src/quality.js` Low/Medium/High presets
- `assets/ai/` the U²-Net-p cutout model with its licence and notice
- `scripts/serve.mjs` the local server, `scripts/build.mjs` the production build
- `tools/` dev tools (need `npm install`; the browser ones need Chrome):
  `assets.mjs` and `views.mjs` (the CC0 asset pipelines; `hdr.mjs` reads the
  panoramas), `ui-pictures.mjs` and `template-thumbs.mjs` (interface pictures),
  `smoke.mjs` (browser checks), `shoot.mjs` and `ui-shots.mjs` (screenshots),
  `measure.mjs` (frame rate, redraws, GPU work, memory)
