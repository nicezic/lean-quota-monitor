export type MoveDirection = 'up' | 'down';

export function normalizeProviderOrder(
  configured: readonly string[],
  available: readonly string[],
): string[] {
  const availableSet = new Set(available);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const key of configured) {
    if (!availableSet.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }

  for (const key of available) {
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }

  return result;
}

export function moveProvider(
  order: readonly string[],
  key: string,
  direction: MoveDirection,
): string[] {
  const result = [...order];
  const index = result.indexOf(key);
  if (index < 0) return result;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= result.length) return result;
  [result[index], result[target]] = [result[target], result[index]];
  return result;
}

export function moveProviderAmong(
  order: readonly string[],
  key: string,
  direction: MoveDirection,
  movableKeys: readonly string[],
): string[] {
  const movableSet = new Set(movableKeys);
  const visible = order.filter((entry) => movableSet.has(entry));
  const index = visible.indexOf(key);
  if (index < 0) return [...order];
  const neighborIndex = direction === 'up' ? index - 1 : index + 1;
  if (neighborIndex < 0 || neighborIndex >= visible.length) return [...order];

  const neighbor = visible[neighborIndex];
  const result = [...order];
  const keyIndex = result.indexOf(key);
  const neighborOrderIndex = result.indexOf(neighbor);
  if (keyIndex < 0 || neighborOrderIndex < 0) return result;
  [result[keyIndex], result[neighborOrderIndex]] = [result[neighborOrderIndex], result[keyIndex]];
  return result;
}

export function renameProviderInOrder(
  order: readonly string[],
  oldKey: string,
  newKey: string,
): string[] {
  const renamed = order.map((key) => (key === oldKey ? newKey : key));
  return [...new Set(renamed)];
}

export function removeProviderFromOrder(order: readonly string[], key: string): string[] {
  return order.filter((entry) => entry !== key);
}
