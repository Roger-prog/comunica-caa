let searchLifecycle;
window.comunicaUnregisterSearch = () => { searchLifecycle?.abort(); searchLifecycle = undefined; };
window.comunicaRegisterSearch = (search) => {
  window.comunicaUnregisterSearch();
  const registry = document.modelContext;
  if (!registry?.registerTool) return;
  searchLifecycle = new AbortController();
  try {
    Promise.resolve(registry.registerTool({
      name: 'filter_vocabulary', title: 'Filtrar palavras da prancha',
      description: 'Abre a prancha da criança já selecionada e filtra seu vocabulário. Não reproduz voz nem grava interações.',
      inputSchema: {type: 'object', properties: {query: {type: 'string', maxLength: 60}}, required: ['query'], additionalProperties: false},
      annotations: {readOnlyHint: false},
      async execute(input) {
        if (!input || typeof input.query !== 'string' || input.query.length > 60 || Object.keys(input).some(k => k !== 'query')) throw new Error('Informe uma busca com até 60 caracteres.');
        search(input.query);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return {query: input.query, view: 'prancha'};
      }
    }, {signal: searchLifecycle.signal})).catch(() => {});
  } catch (_) { /* Browsers without this experimental API remain fully usable. */ }
};
