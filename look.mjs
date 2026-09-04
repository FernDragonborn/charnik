import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
await p.goto('http://localhost:5173/combat', { waitUntil: 'networkidle' });
await p.waitForTimeout(1800);
const el = p.getByText(/Pact Magic ·/).first();
const n = await el.count();
console.log('pact strip found:', n);
if (n) {
	const panel = el.locator('xpath=ancestor::*[contains(@class,"panel")][1]');
	await panel.screenshot({ path: 'design-preview/pact-pool-check.png' });
	console.log('label:', (await el.textContent()).trim());
}
await b.close();
