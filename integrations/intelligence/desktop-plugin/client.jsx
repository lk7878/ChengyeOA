import React from 'react';
import logo from './assets/baiyou-logo.jpg';

export const inject = ['slots', 'locale'];

function BrandMark({ size = 32 }) {
  return <img src={logo} alt="百佑智鉴" width={size} height={size}
    style={{ display: 'block', objectFit: 'contain', borderRadius: 4, background: '#fff', flexShrink: 0 }} />;
}

function BrandName({ t }) {
  return <span style={{ fontSize: 16, whiteSpace: 'nowrap' }}>{t('name')}</span>;
}

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register('baiyou.brand', { zh: { name: '百佑办案助手' }, en: { name: '百佑办案助手' } }));
  for (const slot of ['sidebar.brand.mark', 'conversation.hero.brand.mark']) {
    ctx.slots.inject(slot, () => ctx.slots.register({ name: slot, priority: -100 }, BrandMark));
  }
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({ name: 'sidebar.brand.name', locale: 'baiyou.brand', priority: -100 }, BrandName));
  // The native layout owns session/document titles; this plugin owns the icon.
  ctx.effect(() => {
    const icons = [...document.querySelectorAll('link[rel~="icon"]')];
    const previous = icons.map(icon => icon.getAttribute('href'));
    for (const icon of icons) icon.href = logo;
    return () => {
      icons.forEach((icon, index) => previous[index] === null ? icon.removeAttribute('href') : icon.setAttribute('href', previous[index]));
    };
  });
}
