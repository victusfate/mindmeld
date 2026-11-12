// Resolves `import 'vscode'` to the in-repo fake so extension sources run under node:test unchanged.
import { registerHooks } from 'node:module';

const FAKE = new URL('./fake-vscode.ts', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === 'vscode' ? { url: FAKE, shortCircuit: true } : nextResolve(specifier, context);
  },
});
