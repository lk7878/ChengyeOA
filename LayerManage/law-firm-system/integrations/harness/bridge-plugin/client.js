// Registers a root-mounted effect through Harness' public slot API.
window.__ModuleLoader__.load({
  id: '@chengyeoa/dsh-oa-bridge',
  factory: require => {
    const { useEffect } = require('react');
    return {
      inject: ['layout', 'slots'],
      apply(ctx) {
        const requested = new URLSearchParams(window.location.hash.slice(1)).get('oa-view');
        function Entry() {
          useEffect(() => {
            if (requested === 'knowledge') ctx.layout.openPrimaryPage('knowledge-base');
            const url = new URL(window.location.href); url.hash = '';
            window.history.replaceState(null, '', url);
          }, []);
          return null;
        }
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'chengye-entry' }, Entry));
      },
    };
  },
});
