import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationDestination } from '../api/branch-navigation.js';

test('branded branch links redirect only to approved Google Maps and Waze destinations', () => {
  const maps = navigationDestination({ branch: 'petaling-jaya', provider: 'maps' });
  const waze = navigationDestination({ branch: 'kuching-satok', provider: 'waze' });
  assert.match(maps, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=15%2C%20Ground%20Floor/);
  assert.match(waze, /^https:\/\/waze\.com\/ul\?q=LOT%20442%2C%20Ground%20Floor/);
  assert.match(waze, /&navigate=yes$/);
  assert.equal(navigationDestination({ branch: 'unknown', provider: 'maps' }), '');
  assert.equal(navigationDestination({ branch: 'petaling-jaya', provider: 'https://evil.example' }), '');
});

