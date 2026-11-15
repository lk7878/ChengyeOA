import { FreeSearchCard, ENGINES, bridgeDescribe, bridgeMutate, NS } from './FreeSearchCard.js';
export const inject = ['slots', 'commandUi'];
export function apply(ctx) {
    ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
        name: 'settings.plugin.item',
        key: 'free-web-search',
        id: 'dsh-free-web-search',
        order: 120,
        inject: () => ({}),
    }, FreeSearchCard));
    ctx.inject(['commandUi'], (sctx) => {
        const command = sctx.get('commandUi');
        sctx.effect(() => {
            const dispose = command.register({
                name: 'free-search-engine',
                description: 'Switch web search engine',
                available: () => true,
                ui: {
                    kind: 'popupSelect',
                    options: async () => {
                        const result = await bridgeDescribe();
                        const view = result.ok ? result.value?.namespaces.find((n) => n.ns === NS) : undefined;
                        const current = view?.value?.provider ?? 'bing';
                        return ENGINES.map(e => ({
                            id: e.id,
                            label: `${e.label}${e.badge === 'FREE' ? ' · Free' : ' · API Key'}`,
                            detail: e.id === current ? 'current' : undefined,
                            active: e.id === current,
                        }));
                    },
                    onSelect: async (option) => {
                        await bridgeMutate({ ns: NS, ops: [{ op: 'set', path: ['provider'], value: option.id }] });
                    },
                },
            });
            return dispose;
        }, 'free-web-search: /free-search-engine command');
    });
}
