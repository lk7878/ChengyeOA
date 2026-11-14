// On Windows sharp must load before PDF canvas libraries with overlapping DLL
// names. Keep this runtime compatibility seam outside the upstream snapshot.
if (process.platform === 'win32') await import('../../../third_party/deepseek-harness/packages/attachment/attachment-local/node_modules/sharp/dist/index.mjs');
