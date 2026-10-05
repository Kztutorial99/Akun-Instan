export function catalogPlatformFromSearch(search, keys) {
  const platform = new URLSearchParams(search).get('platform') || '';
  return keys.includes(platform) ? platform : '';
}
export function catalogBannerVisible(platform) {
  return !platform;
}
