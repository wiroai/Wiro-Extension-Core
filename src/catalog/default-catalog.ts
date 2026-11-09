import type { Catalog } from './catalog.js';

// Bundled copy of the action catalog. The live one is served from wiro.ai and
// wins when it loads. Categories only: models come from Wiro at run time.

export const DEFAULT_CATALOG: Catalog = {
  version: 1,
  actions: [
    // Image
    { id: 'make-video', kind: 'image', group: 1, label: 'Make a video…', categories: ['image-to-video'], prompt: 'optional', promptHint: 'Describe the motion, for example: the camera slowly pushes in' },
    { id: 'edit-image', kind: 'image', group: 1, label: 'Edit image…', categories: ['image-editing'], prompt: 'required', promptHint: 'What should change? For example: put the bottle on a wet black stone' },
    { id: 'upscale', kind: 'image', group: 1, label: 'Upscale…', categories: ['upscale'], prompt: 'hidden' },
    { id: 'restore', kind: 'image', group: 1, label: 'Restore photo…', categories: ['restoration'], prompt: 'hidden' },
    { id: 'remove-background', kind: 'image', group: 1, label: 'Remove background', categories: ['background-removal'], prompt: 'hidden' },
    { id: 'find-objects', kind: 'image', group: 1, label: 'Find objects…', categories: ['object-detection'], prompt: 'optional', promptHint: 'What to find, for example: every bicycle' },
    { id: 'generate-3d', kind: 'image', group: 1, label: 'Generate 3D model…', categories: ['3d-generation'], prompt: 'hidden' },
    { id: 'ask-image', kind: 'image', group: 2, label: 'Ask about this image…', categories: ['image-to-text'], prompt: 'optional', promptHint: 'Ask anything, or leave empty for a description' },
    { id: 'extract-text', kind: 'image', group: 2, label: 'Extract text', categories: ['ocr'], prompt: 'hidden' },
    { id: 'translate-image', kind: 'image', group: 2, label: 'Translate text in image…', categories: ['translate'], prompt: 'hidden' },
    { id: 'product-ad', kind: 'image', group: 3, label: 'Make a product ad…', categories: ['product-ads'], prompt: 'optional' },
    { id: 'effects', kind: 'image', group: 3, label: 'Effects…', categories: ['wiro-effects'], prompt: 'hidden' },
    { id: 'song-from-image', kind: 'image', group: 3, label: 'Make a song from it…', categories: ['image-to-song'], prompt: 'optional', promptHint: 'Style or mood, for example: warm acoustic' },
    { id: 'talking-avatar', kind: 'image', group: 3, label: 'Make it talk…', categories: ['talking-head'], prompt: 'optional' },
    { id: 'try-on', kind: 'image', group: 3, label: 'Try it on…', categories: ['virtual-try-on'], prompt: 'hidden' },
    { id: 'image-tools', kind: 'image', group: 4, label: 'Convert and tools…', categories: ['utils'], prompt: 'hidden' },

    // Video
    { id: 'edit-video', kind: 'video', group: 1, label: 'Edit video…', categories: ['video-to-video'], prompt: 'required', promptHint: 'What should change? For example: turn the road into fresh snow' },
    { id: 'upscale-video', kind: 'video', group: 1, label: 'Upscale video…', categories: ['upscale'], prompt: 'hidden' },
    { id: 'add-music', kind: 'video', group: 1, label: 'Add music…', categories: ['music-generation'], prompt: 'optional', promptHint: 'Mood, for example: calm piano' },
    { id: 'ask-video', kind: 'video', group: 2, label: 'Ask about this video…', categories: ['video-to-text'], prompt: 'optional', promptHint: 'Ask anything, or leave empty for a description' },
    { id: 'video-tools', kind: 'video', group: 3, label: 'Captions, trim, merge and tools…', categories: ['utils'], prompt: 'hidden' },

    // Audio
    { id: 'transcribe', kind: 'audio', group: 1, label: 'Transcribe', categories: ['speech-to-text'], prompt: 'hidden', skipLive: true },
    { id: 'change-voice', kind: 'audio', group: 1, label: 'Change the voice…', categories: ['speech-to-speech'], prompt: 'hidden', skipLive: true },
    { id: 'audio-tools', kind: 'audio', group: 2, label: 'Trim, fade and tools…', categories: ['utils'], prompt: 'hidden' },

    // Selected text
    { id: 'generate-image', kind: 'selection', group: 1, label: 'Generate image…', categories: ['text-to-image'], prompt: 'required' },
    { id: 'generate-video', kind: 'selection', group: 1, label: 'Generate video…', categories: ['text-to-video'], prompt: 'required' },
    { id: 'read-aloud', kind: 'selection', group: 1, label: 'Read aloud…', categories: ['text-to-speech'], prompt: 'required', skipLive: true },
    { id: 'make-song', kind: 'selection', group: 1, label: 'Make a song…', categories: ['text-to-song'], prompt: 'required' },
    { id: 'translate-text', kind: 'selection', group: 2, label: 'Translate…', categories: ['translate'], prompt: 'required' },
    { id: 'summarize', kind: 'selection', group: 2, label: 'Summarize or rewrite…', categories: ['chat'], prompt: 'required', skipLive: true },

    // Page
    { id: 'page-video', kind: 'page', group: 1, label: 'Make a video of this page…', categories: [], agent: 'studio' },
    { id: 'ask-page', kind: 'page', group: 1, label: 'Ask about this page…', categories: ['rag'], input: 'url', prompt: 'required', promptHint: 'Ask a question about this page' },
  ],
  more: {
    image: [
      { category: 'image-to-image', label: 'Image to image' },
      { category: 'image-editing', label: 'Edit with a prompt' },
      { category: 'image-to-video', label: 'Image to video' },
      { category: 'image-to-text', label: 'Image to text' },
      { category: 'image-to-song', label: 'Image to song' },
      { category: 'talking-head', label: 'Talking avatar' },
      { category: '3d-generation', label: '3D models' },
      { category: 'wiro-effects', label: 'Effects' },
      { category: 'product-ads', label: 'Product ads' },
      { category: 'utils', label: 'Tools' },
    ],
    video: [
      { category: 'video-to-video', label: 'Video to video' },
      { category: 'video-to-text', label: 'Video to text' },
      { category: 'music-generation', label: 'Music' },
      { category: 'utils', label: 'Tools' },
    ],
    audio: [
      { category: 'speech-to-text', label: 'Speech to text' },
      { category: 'speech-to-speech', label: 'Speech to speech' },
      { category: 'voice-clone', label: 'Voice clone' },
      { category: 'utils', label: 'Tools' },
    ],
    selection: [
      { category: 'text-to-image', label: 'Text to image' },
      { category: 'text-to-video', label: 'Text to video' },
      { category: 'text-to-speech', label: 'Text to speech' },
      { category: 'text-to-song', label: 'Text to song' },
      { category: 'text-to-music', label: 'Text to music' },
      { category: 'translate', label: 'Translate' },
      { category: 'chat', label: 'Chat models' },
    ],
    page: [
      { category: 'rag', label: 'Ask about a page or document' },
    ],
  },
};
