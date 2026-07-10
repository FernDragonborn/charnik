// Transient UI-layout state (not persisted, not domain data). `fullBleed` lets a view ask the shell
// for the whole viewport width (the 3-column editor / translate layouts) instead of the centred
// 1040px column. A route sets it while it needs the width and clears it on leave.
export const ui = $state({
	/** when true, `+layout`'s <main> drops its centred padding and spans full width. */
	fullBleed: false
});
