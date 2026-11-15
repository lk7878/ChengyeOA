import { settingsNamespace } from '@deepseek-ai/dsh-settings';
export const FREE_SEARCH_NS = settingsNamespace('free-search');
export const ALL_ENGINES = [
    'ddg', 'ddg-lite', 'bing', 'searxng', 'anysearch',
    'exa', 'tavily', 'keenable', 'perplexity', 'deepseek-official',
];
export const FREE_ENGINES = ['ddg', 'ddg-lite', 'bing', 'searxng', 'anysearch'];
