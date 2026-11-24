export const PLAY_VIEWPORTS = [
	{ width: 1280, touch: false, play: 'main .hero' },
	{ width: 768, touch: false, play: 'main .column-play .pane:nth-child(3)' },
	{ width: 512, touch: false, play: 'main .column-play .pane:nth-last-child(1):nth-child(2)' },
	{ width: 393, touch: true, play: 'main .phone-play' },
	{ width: 320, touch: true, play: 'main .phone-play' },
];

export function viewportOptions({ width, touch }, height) {
	return { viewport: { width, height }, isMobile: touch, hasTouch: touch, reducedMotion: 'reduce' };
}

export async function dismissMobileWarning(page) {
	const button = page.locator('.mobile-warning .continue');
	if (await button.isVisible()) await button.click();
}
