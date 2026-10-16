// Everything Meu Ambiente uses that it did not make itself, with its licence.
// All of it allows public and commercial use. ASSETS.md has the same list in
// full, file by file.
import manifest from '../assets/manifest.json' with { type: 'json' };

// what the app loads from elsewhere, or ships under someone else's licence
export const CREDITS = {
  ai: [
    { name: 'BiRefNet lite', by: 'Peng Zheng et al.', licence: 'MIT', url: 'https://huggingface.co/onnx-community/BiRefNet_lite-ONNX' },
    { name: 'U²-Net-p', by: 'Xuebin Qin et al.', licence: 'Apache 2.0', url: 'https://github.com/xuebinqin/U-2-Net' },
    { name: 'CLIP ViT-B/32', by: 'OpenAI', licence: 'MIT', url: 'https://huggingface.co/Xenova/clip-vit-base-patch32' },
  ],
  libraries: [
    { name: 'three.js', by: 'three.js authors', licence: 'MIT', url: 'https://threejs.org' },
    { name: 'Transformers.js', by: 'Hugging Face', licence: 'Apache 2.0', url: 'https://github.com/huggingface/transformers.js' },
    { name: 'ONNX Runtime Web', by: 'Microsoft', licence: 'MIT', url: 'https://onnxruntime.ai' },
  ],
  fonts: [
    { name: 'Plus Jakarta Sans', by: 'Tokotype', licence: 'SIL OFL 1.1', url: 'https://fonts.google.com/specimen/Plus+Jakarta+Sans' },
    { name: 'Fraunces', by: 'Undercase Type', licence: 'SIL OFL 1.1', url: 'https://fonts.google.com/specimen/Fraunces' },
  ],
};

// the Poly Haven models, textures and panoramas, with their authors (CC0 1.0)
export function polyHaven() {
  const list = [
    ...Object.values(manifest.models || {}).map((m) => ({ kind: 'model', name: m.name, authors: m.authors, url: m.source })),
    ...Object.values(manifest.textures || {}).map((m) => ({ kind: 'texture', name: m.name, authors: m.authors, url: m.source })),
    ...Object.values(manifest.viewCredits || {}).map((m) => ({ kind: 'view', name: m.name, authors: m.authors, url: m.source })),
  ];
  return list.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}
