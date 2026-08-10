// Node'un yerleşik TS desteğinde uzantısız içe aktarmalar çözülemez
// (src içinde './buffers' gibi yazımlar Vite için, Node .ts ister).
// verify-preset.mjs bunu register() ile önce yükler; sonraki tüm çözümlerde
// göreli uzantısız specifier'lara önce .ts ekleyerek dener.
export async function resolve(specifier, context, nextResolve) {
  const isRelativeExtensionless =
    specifier.startsWith('.') &&
    !specifier.endsWith('.js') &&
    !specifier.endsWith('.ts') &&
    !specifier.endsWith('.json');
  if (isRelativeExtensionless) {
    try {
      return await nextResolve(specifier + '.ts', context);
    } catch {
      // uzantısız gerçek bir dosya olabilir (örn. node_modules bağımlısı)
    }
  }
  return nextResolve(specifier, context);
}
