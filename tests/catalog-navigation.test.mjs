import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogPlatformFromSearch, catalogBannerVisible } from '../src/catalog-navigation.mjs';
test('Google selection restores its own catalog view from the URL', () => {
  assert.equal(catalogPlatformFromSearch('?platform=google', ['google', 'facebook']), 'google');
  assert.equal(catalogPlatformFromSearch('?platform=invalid', ['google', 'facebook']), '');
  assert.equal(catalogPlatformFromSearch('', ['google', 'facebook']), '');
});
test('banner is visible only without a selected platform', () => {
  assert.equal(catalogBannerVisible(''), true);
  assert.equal(catalogBannerVisible('google'), false);
  assert.equal(catalogBannerVisible('facebook'), false);
});
