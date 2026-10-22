export const SPEECH_DEFAULTS = Object.freeze({ enabled: false, autoReply: false, autoStyle: true, baseURL: 'https://token-plan-cn.xiaomimimo.com/v1', model: 'mimo-v2.5-tts', voice: '冰糖', voiceDescription: '', style: '', maxChars: 500 });
export const SPEECH_MODELS = ['mimo-v2.5-tts', 'mimo-v2.5-tts-voicedesign'];
export const SPEECH_VOICES = ['mimo_default','冰糖','茉莉','苏打','白桦','Mia','Chloe','Milo','Dean'];
export const SPEECH_ENDPOINTS = ['https://api.xiaomimimo.com/v1', ...['cn','sgp','ams'].map(region => `https://token-plan-${region}.xiaomimimo.com/v1`)];
