# Third-party assets and licences

Everything Meu Ambiente uses that it did not make itself is listed here. All of
it may be used publicly and commercially. Nothing was bought and no account was
needed. The same list, with links, is in the app under Settings › About and credits.

| What | Source | Licence |
|---|---|---|
| 3D models, surface textures, window-view panoramas | Poly Haven | CC0 1.0 (public domain) |
| three.js 0.183.2 (loaded from jsDelivr) | three.js authors | MIT |
| Transformers.js 4.3.1 (loaded from jsDelivr, only for photo items) | Hugging Face | Apache 2.0 |
| ONNX Runtime Web 1.22.0 (loaded from jsDelivr, only for photo items) | Microsoft | MIT |
| BiRefNet lite (AI cutout on WebGPU, from Hugging Face) | Peng Zheng et al. | MIT |
| U²-Net-p (AI cutout without WebGPU, served with the app) | Xuebin Qin et al. | Apache 2.0 |
| CLIP ViT-B/32 (suggests what a photo shows, from Hugging Face) | OpenAI | MIT |
| Depth Anything V2 small (gives photo items their depth, from Hugging Face) | Lihe Yang et al. | Apache 2.0 |
| Hunyuan3D 3 through fal.ai (optional full 3D models; paid, server side) | Tencent / fal.ai | fal.ai terms; outputs are the user's |
| Plus Jakarta Sans, Fraunces (Google Fonts) | Tokotype, Undercase Type | SIL OFL 1.1 |

## AI models

Downloaded only when someone adds a piece from a photo, and cached by the browser.

- **BiRefNet lite**, `onnx-community/BiRefNet_lite-ONNX` (fp16, 115 MB), MIT.
  https://github.com/ZhengPeng7/BiRefNet
- **U²-Net-p**, `assets/ai/u2netp.onnx` (4.6 MB), Apache 2.0. The licence and
  notice are next to it (`assets/ai/LICENSE-Apache-2.0.txt`, `assets/ai/NOTICE.txt`).
  https://github.com/xuebinqin/U-2-Net. It replaced RMBG-1.4, whose licence
  (CC BY-NC 4.0) does not allow commercial use.
- **CLIP ViT-B/32**, `Xenova/clip-vit-base-patch32` (quantised, about 90 MB), the
  ONNX export of OpenAI's CLIP, MIT. https://github.com/openai/CLIP
- **Depth Anything V2 small**, `onnx-community/depth-anything-v2-small` (fp16,
  50 MB on WebGPU; 8-bit, 27 MB on WASM), Apache 2.0. Only the small model is
  Apache 2.0; the base and large ones are CC BY-NC 4.0 and are not used.
  https://github.com/DepthAnything/Depth-Anything-V2

## Poly Haven (CC0 1.0)

`tools/assets.mjs` (models and textures) and `tools/views.mjs` (window views)
download and prepare these from the Poly Haven public API (https://polyhaven.com,
licence: https://polyhaven.com/license) and write `assets/manifest.json` with
real-world sizes and credits. CC0 needs no credit; it is given anyway.

### 3D models

1k glTF, optimised to `.glb`: meshopt geometry (the candlestick, the leafy plant
and one vase also simplified within 0.05% of their size), WebP textures at 1024 px,
512 px for small decor. Each is loaded only when a room uses it.

| File | Name | Authors | Size | Source |
|---|---|---|---|---|
| `ceramic_vase_01` | Ceramic Vase 01 | James Ray Cock | 81 KB | https://polyhaven.com/a/ceramic_vase_01 |
| `ceramic_vase_02` | Ceramic Vase 02 | James Ray Cock | 127 KB | https://polyhaven.com/a/ceramic_vase_02 |
| `ceramic_vase_03` | Ceramic Vase 03 | James Ray Cock | 80 KB | https://polyhaven.com/a/ceramic_vase_03 |
| `ceramic_vase_04` | Ceramic Vase 04 | James Ray Cock | 100 KB | https://polyhaven.com/a/ceramic_vase_04 |
| `coffee_table_round_01` | Coffee Table Round 01 | Ulan Cabanilla | 189 KB | https://polyhaven.com/a/coffee_table_round_01 |
| `dining_chair_02` | Dining Chair 02 | James Ray Cock | 284 KB | https://polyhaven.com/a/dining_chair_02 |
| `hanging_picture_frame_01` | Hanging Picture Frame 01 | James Ray Cock | 53 KB | https://polyhaven.com/a/hanging_picture_frame_01 |
| `hanging_picture_frame_02` | Hanging Picture Frame 02 | James Ray Cock | 92 KB | https://polyhaven.com/a/hanging_picture_frame_02 |
| `hanging_picture_frame_03` | Hanging Picture Frame 03 | James Ray Cock | 248 KB | https://polyhaven.com/a/hanging_picture_frame_03 |
| `metal_stool_01` | Metal Stool 01 | Ulan Cabanilla | 340 KB | https://polyhaven.com/a/metal_stool_01 |
| `mid_century_lounge_chair` | Mid Century Lounge Chair | Kuutti Siitonen | 288 KB | https://polyhaven.com/a/mid_century_lounge_chair |
| `modern_arm_chair_01` | Modern Arm Chair 01 | Vibrant Nordic | 319 KB | https://polyhaven.com/a/modern_arm_chair_01 |
| `modern_ceiling_lamp_01` | Modern Ceiling Lamp 01 | James Ray Cock | 154 KB | https://polyhaven.com/a/modern_ceiling_lamp_01 |
| `modern_coffee_table_01` | Modern Coffee Table 01 | Amin | 169 KB | https://polyhaven.com/a/modern_coffee_table_01 |
| `modern_wooden_cabinet` | Modern Wooden Cabinet | Patrik Pangerl | 447 KB | https://polyhaven.com/a/modern_wooden_cabinet |
| `office_notepads` | Office Notepads | Ulan Cabanilla | 25 KB | https://polyhaven.com/a/office_notepads |
| `Ottoman_01` | Ottoman 01 | Caspian Fortune | 312 KB | https://polyhaven.com/a/Ottoman_01 |
| `painted_wooden_chair_01` | Painted Wooden Chair 01 | Kuutti Siitonen | 197 KB | https://polyhaven.com/a/painted_wooden_chair_01 |
| `painted_wooden_nightstand` | Painted Wooden Nightstand | Kirill Sannikov | 268 KB | https://polyhaven.com/a/painted_wooden_nightstand |
| `potted_plant_01` | Potted Plant 01 | Rico Cilliers | 1143 KB | https://polyhaven.com/a/potted_plant_01 |
| `potted_plant_02` | Potted Plant 02 | Rico Cilliers | 870 KB | https://polyhaven.com/a/potted_plant_02 |
| `potted_plant_04` | Potted Plant 04 | James Ray Cock | 176 KB | https://polyhaven.com/a/potted_plant_04 |
| `round_wooden_table_01` | Round Wooden Table 01 | Ulan Cabanilla | 178 KB | https://polyhaven.com/a/round_wooden_table_01 |
| `side_table_01` | Side Table 01 | James Ray Cock | 185 KB | https://polyhaven.com/a/side_table_01 |
| `sofa_02` | Sofa 02 | Kirill Sannikov | 165 KB | https://polyhaven.com/a/sofa_02 |
| `standing_picture_frame_01` | Standing Picture Frame 01 | James Ray Cock | 57 KB | https://polyhaven.com/a/standing_picture_frame_01 |
| `stationery_supplies` | Stationery Supplies | Mateusz Sadek | 103 KB | https://polyhaven.com/a/stationery_supplies |
| `throw_pillows_01` | Throw Pillows 01 | Serhii Khromov | 203 KB | https://polyhaven.com/a/throw_pillows_01 |
| `wall_clock` | Wall Clock | PierreB3D | 95 KB | https://polyhaven.com/a/wall_clock |
| `wicker_basket_01` | Wicker Basket 01 | Kuutti Siitonen | 275 KB | https://polyhaven.com/a/wicker_basket_01 |
| `wooden_bowl_01` | Wooden Bowl 01 | Oliver Harries | 144 KB | https://polyhaven.com/a/wooden_bowl_01 |
| `wooden_candlestick` | Wooden Candlestick | Josh Dean | 159 KB | https://polyhaven.com/a/wooden_candlestick |
| `wooden_display_shelves_01` | Wooden Display Shelves 01 | James Ray Cock | 167 KB | https://polyhaven.com/a/wooden_display_shelves_01 |

### Surface textures

1k maps as WebP: a neutral detail map (from the diffuse, so our own colours tint
it) and a normal map at 1024 px, and a roughness map at 512 px.

| Folder | Name | Authors | Size | Source |
|---|---|---|---|---|
| `american_walnut_veneer` | American Walnut Veneer | Jenelle van Heerden | 137 KB | https://polyhaven.com/a/american_walnut_veneer |
| `beige_wall_001` | Beige Wall 001 | Dimitrios Savva, Rico Cilliers | 110 KB | https://polyhaven.com/a/beige_wall_001 |
| `concrete_floor_02` | Concrete Floor 02 | Rob Tuytel | 568 KB | https://polyhaven.com/a/concrete_floor_02 |
| `cotton_jersey` | Cotton Jersey | colormass, Rico Cilliers | 128 KB | https://polyhaven.com/a/cotton_jersey |
| `curly_teddy_natural` | Curly Teddy Natural | colormass, Rico Cilliers | 202 KB | https://polyhaven.com/a/curly_teddy_natural |
| `leather_white` | Leather White | Rob Tuytel | 231 KB | https://polyhaven.com/a/leather_white |
| `oak_veneer_01` | Oak Veneer 01 | Jenelle van Heerden | 167 KB | https://polyhaven.com/a/oak_veneer_01 |
| `poly_wool_herringbone` | Poly Wool Herringbone | colormass, Rico Cilliers | 599 KB | https://polyhaven.com/a/poly_wool_herringbone |
| `rough_linen` | Rough Linen | colormass, Rico Cilliers | 487 KB | https://polyhaven.com/a/rough_linen |
| `velour_velvet` | Velour Velvet | colormass, Rico Cilliers | 269 KB | https://polyhaven.com/a/velour_velvet |
| `white_oak_veneer` | White Oak Veneer | Jenelle van Heerden | 143 KB | https://polyhaven.com/a/white_oak_veneer |

### Window views

Panoramas (HDRIs) exposed for a natural photo look, cut to the band a window
shows, softened slightly and saved as 3072 px WebP, plus a small picture for the
view picker. The garden at sunset is the day photo regraded. Only the chosen
view's three photos download, when it is first shown.

| File | Panorama | Authors | Size | Source |
|---|---|---|---|---|
| `garden-day.webp` | Symmetrical Garden 02 | Dimitrios Savva, Jarod Guest | 253 KB | https://polyhaven.com/a/symmetrical_garden_02 |
| `garden-sunset.webp` | Symmetrical Garden 02 | Dimitrios Savva, Jarod Guest | 251 KB | https://polyhaven.com/a/symmetrical_garden_02 |
| `garden-night.webp` | Ladybrand Heritage House | Dario Barresi | 158 KB | https://polyhaven.com/a/ladybrand_heritage_house |
| `ocean-day.webp` | Illovo Beach Balcony | Greg Zaal | 89 KB | https://polyhaven.com/a/illovo_beach_balcony |
| `ocean-sunset.webp` | The Sky Is On Fire | Greg Zaal, Rico Cilliers | 76 KB | https://polyhaven.com/a/the_sky_is_on_fire |
| `ocean-night.webp` | Blue Lagoon Night | Greg Zaal | 62 KB | https://polyhaven.com/a/blue_lagoon_night |
| `city-day.webp` | Homecoming Center Rooftop | Dario Barresi | 117 KB | https://polyhaven.com/a/homecoming_center_rooftop |
| `city-sunset.webp` | Joburg Central Sunset | Greg Zaal, Dimitrios Savva | 107 KB | https://polyhaven.com/a/sunset_jhbcentral |
| `city-night.webp` | Shanghai Bund | Greg Zaal | 119 KB | https://polyhaven.com/a/shanghai_bund |

## Made in this project

- Procedural surfaces (`src/materials.js`): marble and stone, glazed tile,
  ceramic, brushed metal, and fallbacks for every photo set.
- Floor and wall layouts drawn in the shader (`src/layout.js`).
- Our own furniture (`src/catalog.js`): armchair, pouf, beds, tables, storage,
  kitchen and bathroom pieces, rugs, books, foliage, the floor and table lamps,
  the upholstered bed, wall lights, and framed prints whose abstract artwork is
  painted in code from each room's palette.
- Interface pictures (`assets/ui/`): material swatches and style previews
  rendered from our own materials by `tools/ui-pictures.mjs`; the icons and the logo.
- Room templates (`src/templates.js`) and their gallery pictures
  (`assets/templates/*.webp`, rendered by `tools/template-thumbs.mjs`).
- The room model, plinth and balcony (`src/roomModel.js`), the backdrop and
  studio environment (`src/look.js`), the window glass (`src/views.js`).
