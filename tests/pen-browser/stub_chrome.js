// 확장 밖에서 패널 스크립트를 돌리기 위한 가짜 chrome API (시험 전용, tests/pen-browser/run.py 가 쓴다)
window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => window.__errors.push('rejection: ' + (e.reason && e.reason.message)));
const store = { local: {}, session: {} };
const area = (name) => ({
  get: async (key) => (typeof key === 'string' ? { [key]: store[name][key] } : { ...store[name] }),
  set: async (obj) => { Object.assign(store[name], obj); },
  remove: async (key) => { delete store[name][key]; },
});
window.chrome = {
  storage: { local: area('local'), session: area('session') },
  tabs: { query: async () => [], get: async () => { throw new Error('no tab'); }, update: async () => {}, create: async () => ({}) },
  windows: { getAll: async () => [], getCurrent: async () => ({ id: 1 }), update: async () => {} },
  tabGroups: { query: async () => [], update: async () => {} },
  scripting: { executeScript: async () => { throw new Error('no scripting in test'); } },
  runtime: { onMessage: { addListener: () => {} }, getManifest: () => ({ version: 'test' }), getURL: (p) => p, reload: () => { window.__reloaded = true; }, id: 'test' },
};
// 도우미·Ollama 에 실제로 요청하지 않게 막는다
window.fetch = async () => { throw new Error('offline in test'); };
