# Meu Ambiente

Plan and furnish rooms in 3D, right in the browser. Start from a designed room
or an empty one, drag in furniture, pick floors and wall finishes, change the
light from morning to night, and see a real view through the windows. In
Brazilian Portuguese and English.

- Seven room templates (living room, bedroom, bathroom, kitchen, dining room,
  home office, studio) and your own saved templates
- Real 3D furniture and photo textures, with soft shadows, lamp light and
  reflections that refine while the view rests
- Five atmospheres, a daylight slider, and window views (garden, ocean, city)
  from real panoramic photos
- Add a piece of your own from a photo: the background is cut away by an AI
  model that runs in your browser; nothing is uploaded
- Undo, share links, saved automatically in the browser

## Run it

No build step is needed to develop; the browser loads the ES modules directly.

```sh
npm start            # http://127.0.0.1:8765/
npm test             # unit tests (Node 20+)
npm run build        # production build in dist/
npm run preview      # build, then serve dist/ at http://127.0.0.1:8765/
```

`npm install` is only needed for the dev tools (asset pipelines, browser
checks, screenshots); see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Deploy

The site is static. On Vercel, `vercel.json` sets everything: it installs
nothing, runs `npm run build` and publishes `dist/`.

## Credits

3D models, textures and window panoramas are from [Poly Haven](https://polyhaven.com)
(CC0). The AI models (BiRefNet lite, U²-Net-p, CLIP), libraries (three.js,
Transformers.js, ONNX Runtime Web) and fonts (Plus Jakarta Sans, Fraunces) are
under MIT, Apache 2.0 or SIL OFL licences. The full list, with authors, is in
[ASSETS.md](ASSETS.md) and in the app under Settings › About and credits.
