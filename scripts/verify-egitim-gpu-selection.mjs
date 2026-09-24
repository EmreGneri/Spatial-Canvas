import assert from 'node:assert/strict';
import { ayarSec } from '../src/engine/reconstruction/egitim3dgs.ts';

const originalNavigator = globalThis.navigator;
const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

async function check(info, expected) {
  let requestedPreference;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      gpu: {
        async requestAdapter(options) {
          requestedPreference = options.powerPreference;
          return { info };
        },
      },
    },
  });
  const actual = await ayarSec();
  assert.equal(requestedPreference, 'high-performance');
  assert.equal(actual.tier, expected.tier);
  assert.equal(actual.entegreGpu, expected.entegreGpu);
  assert.equal(actual.gpu, expected.gpu);
}

try {
  await check({ vendor: 'Intel', architecture: 'gen-12lp' }, {
    tier: 'quick', entegreGpu: true, gpu: 'Intel / gen-12lp',
  });
  await check({ vendor: 'nvidia', architecture: 'blackwell' }, {
    tier: 'standard', entegreGpu: false, gpu: 'nvidia / blackwell',
  });
  await check({ vendor: 'intel', architecture: 'xe-hpg', description: 'Intel Arc A770' }, {
    tier: 'quick', entegreGpu: false, gpu: 'intel / xe-hpg',
  });
  await check({ vendor: 'intel' }, {
    tier: 'quick', entegreGpu: false, gpu: 'intel / ?',
  });
  await check({ vendor: 'amd', architecture: 'rdna3' }, {
    tier: 'quick', entegreGpu: false, gpu: 'amd / rdna3',
  });
  await check({}, { tier: 'quick', entegreGpu: false, gpu: '? / ?' });
  console.log('3DGS GPU identification and conservative preset selection: OK');
} finally {
  if (originalDescriptor) Object.defineProperty(globalThis, 'navigator', originalDescriptor);
  else if (originalNavigator === undefined) delete globalThis.navigator;
}
