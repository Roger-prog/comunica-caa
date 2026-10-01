// Only public sitekeys and short-lived response tokens enter this bridge.
// Supabase Auth performs secret-key validation on its server.
(() => {
  const mounts = new WeakMap();
  let loading;
  const load = () => {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      let settled = false;
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      const timeout = setTimeout(() => finish(new Error('timeout')), 20000);
      const finish = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error || !window.turnstile) {
          script.remove();
          loading = null;
          reject(error || new Error('unavailable'));
        } else resolve(window.turnstile);
      };
      script.onload = () => finish();
      script.onerror = () => finish(new Error('unavailable'));
      document.head.appendChild(script);
    });
    return loading;
  };
  window.comunicaTurnstileMount = (container, sitekey, compact, verified, expired, failed) => {
    const state = { widgetId: null, removed: false, generation: 0 };
    mounts.set(container, state);
    state.render = async () => {
      const generation = ++state.generation;
      try {
        const api = await load();
        if (state.removed || generation !== state.generation) return;
        // Flutter creates the element before attaching it to the platform view.
        await new Promise(resolve => {
          const attach = () => {
            if (state.removed || container.isConnected) resolve();
            else requestAnimationFrame(attach);
          };
          attach();
        });
        if (state.removed || generation !== state.generation) return;
        state.widgetId = api.render(container, {
          sitekey,
          size: compact ? 'compact' : 'flexible',
          theme: 'light',
          language: 'pt-br',
          'response-field': false,
          'refresh-expired': 'manual',
          callback: token => { if (!state.removed) verified(token); },
          'expired-callback': () => { if (!state.removed) expired(); },
          'timeout-callback': () => { if (!state.removed) expired(); },
          'error-callback': () => { if (!state.removed) failed(); },
        });
      } catch (_) {
        if (!state.removed && generation === state.generation) failed();
      }
    };
    state.render();
  };
  window.comunicaTurnstileReset = container => {
    const state = mounts.get(container);
    if (!state || state.removed) return;
    if (state.widgetId !== null && window.turnstile) {
      try { window.turnstile.reset(state.widgetId); } catch (_) { state.render(); }
    } else state.render();
  };
  window.comunicaTurnstileRemove = container => {
    const state = mounts.get(container);
    if (!state) return;
    state.removed = true;
    ++state.generation;
    if (state.widgetId !== null && window.turnstile) {
      try { window.turnstile.remove(state.widgetId); } catch (_) { /* already removed */ }
    }
    mounts.delete(container);
  };
})();
