// Register the app shell only in secure browser contexts. API and realtime
// traffic are deliberately excluded by sw.js so cached data cannot mask edits.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
	window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => console.warn('PWA registration:', error.message)));
}
