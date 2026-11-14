export function isInventoryDecimal(field: { type: string; options: unknown }): boolean {
  const options = field.options as Record<string, unknown> | null;
  return (
    field.type === 'NUMBER' &&
    !!options &&
    ['INVENTORY_ITEMS', 'INVENTORY_MOVEMENTS', 'INVENTORY_STOCKTAKES'].includes(
      String(options.businessSource),
    ) &&
    [
      'stock',
      'minimumStock',
      'quantity',
      'beforeStock',
      'afterStock',
      'bookStock',
      'actualStock',
      'difference',
    ].includes(String(options.businessKey))
  );
}
