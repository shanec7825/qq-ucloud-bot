export const MIMO_API_BASE_URL = 'https://api.xiaomimimo.com/v1';
export const MIMO_TOKEN_PLAN_CN_BASE_URL = 'https://token-plan-cn.xiaomimimo.com/v1';
export const SPEECH_DEFAULTS = Object.freeze({ enabled: false, autoReply: false, autoStyle: true, baseURL: MIMO_TOKEN_PLAN_CN_BASE_URL, model: 'mimo-v2.5-tts', voice: '冰糖', voiceDescription: '', referenceAudio: '', style: '', directiveVersion: 2, maxChars: 500 });
export const SPEECH_MODELS = ['mimo-v2.5-tts', 'mimo-v2.5-tts-voicedesign', 'mimo-v2.5-tts-voiceclone'];
export const SPEECH_VOICES = ['mimo_default','冰糖','茉莉','苏打','白桦','Mia','Chloe','Milo','Dean'];
export const SPEECH_ENDPOINTS = [MIMO_API_BASE_URL, MIMO_TOKEN_PLAN_CN_BASE_URL, 'https://token-plan-sgp.xiaomimimo.com/v1', 'https://token-plan-ams.xiaomimimo.com/v1'];
