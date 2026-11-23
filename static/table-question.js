// The table's question window: ask Rust for the words, show them as text, and answer once.
// Everything it shows is set through textContent; nothing is parsed as markup. Rust believes an
// answer only from this window (src-tauri/src/table_link/question.rs).
(() => {
	const ipc = window.__TAURI_INTERNALS__;
	if (!ipc) return; // opened outside the app — the web demo serves this file and has no table
	const ask = document.getElementById('question-ask');
	const title = document.getElementById('question-title');
	const code = document.getElementById('question-code');
	const body = document.getElementById('question-body');
	const allow = document.getElementById('question-allow');
	const deny = document.getElementById('question-deny');
	let answered = false;
	const answer = (yes) => {
		if (answered) return;
		answered = true;
		allow.disabled = true;
		deny.disabled = true;
		ipc.invoke('table_question_answer', { allow: yes });
	};
	ipc.invoke('table_question_words').then((words) => {
		if (!words) return;
		document.documentElement.lang = words.locale;
		document.title = words.title;
		ask.textContent = words.ask;
		title.textContent = words.fact;
		code.hidden = !words.code;
		if (words.code) {
			code.querySelector('span').textContent = words.code.label;
			code.querySelector('strong').textContent = words.code.value;
		}
		body.textContent = words.body;
		allow.textContent = words.allow;
		deny.textContent = words.deny;
		allow.disabled = false;
		deny.disabled = false;
		// the safe answer has the focus, so an Enter pressed by habit says no
		deny.focus();
		// the window is as tall as its words, in whichever locale they came
		requestAnimationFrame(() =>
			ipc.invoke('table_question_fit', {
				height: Math.ceil(document.querySelector('main').getBoundingClientRect().height),
			}),
		);
	});
	allow.addEventListener('click', () => answer(true));
	deny.addEventListener('click', () => answer(false));
	document.addEventListener('keydown', (event) => {
		if (event.code === 'Escape') answer(false);
	});
})();
