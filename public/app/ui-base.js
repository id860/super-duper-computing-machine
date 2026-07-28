export const el = (tag, attrs = {}, ...children) => {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (k === 'class') node.className = v;
		else if (k === 'html') node.innerHTML = v;
		else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
		else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
	}
	for (const c of children.flat()) { if (c == null) continue; node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
	return node;
};
export function toast(msg, kind = 'info') {
	let wrap = document.getElementById('toasts');
	if (!wrap) { wrap = el('div', { id: 'toasts' }); document.body.appendChild(wrap); }
	const t = el('div', { class: 'toast toast-' + kind }, msg);
	wrap.appendChild(t);
	requestAnimationFrame(() => t.classList.add('show'));
	setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3400);
}
export function modal(title, body, actions = []) {
	const back = el('div', { class: 'modal-back' });
	const close = () => back.remove();
	const foot = el('div', { class: 'modal-foot' }, ...actions.map((a) => el('button', { class: 'btn ' + (a.primary ? 'btn-primary' : ''), onclick: () => a.onClick(close) }, a.label)));
	const box = el('div', { class: 'modal' },
		el('div', { class: 'modal-head' }, el('h3', {}, title), el('button', { class: 'icon-btn', onclick: close }, '✕')),
		el('div', { class: 'modal-body' }, body),
		actions.length ? foot : null
	);
	back.appendChild(box);
	back.addEventListener('click', (e) => { if (e.target === back) close(); });
	document.body.appendChild(back);
	return close;
}
const ICON_BITS = {
	pixel: [[3,3],[4,3],[5,3],[3,4],[4,4],[5,4],[3,5],[4,5],[5,5]],
	brush2: [[2,2],[3,2],[2,3],[3,3],[6,2],[7,2],[6,3],[7,3],[2,6],[3,6],[2,7],[3,7],[6,6],[7,6],[6,7],[7,7]],
	brush3: [[1,1],[4,1],[7,1],[1,4],[4,4],[7,4],[1,7],[4,7],[7,7]],
	line: [[1,7],[2,6],[3,5],[4,4],[5,3],[6,2],[7,1]],
	rect: [[2,2],[3,2],[4,2],[5,2],[6,2],[2,6],[3,6],[4,6],[5,6],[6,6],[2,3],[2,4],[2,5],[6,3],[6,4],[6,5]],
	fill: [[3,1],[2,2],[4,2],[2,3],[3,3],[4,3],[5,3],[3,4],[4,4],[5,4],[6,4],[4,5],[5,5],[6,5],[7,6],[7,7]],
	picker: [[4,1],[4,2],[1,4],[2,4],[4,4],[6,4],[7,4],[4,6],[4,7]],
	move: [[4,0],[3,1],[4,1],[5,1],[4,2],[4,3],[4,4],[4,5],[4,6],[4,7],[4,8],[3,7],[5,7],[0,4],[1,3],[1,4],[1,5],[2,4],[3,4],[5,4],[6,4],[7,4],[8,4],[7,3],[7,5]],
	copy: [[1,1],[2,1],[3,1],[4,1],[1,2],[1,3],[1,4],[4,2],[4,3],[4,4],[2,4],[3,4],[5,4],[6,4],[7,4],[5,5],[5,6],[5,7],[7,5],[7,6],[7,7],[6,7]],
	stamp: [[2,2],[3,2],[4,2],[5,2],[6,2],[2,6],[3,6],[4,6],[5,6],[6,6],[2,3],[2,4],[2,5],[6,3],[6,4],[6,5],[4,4]],
	template: [[2,2],[4,2],[6,2],[2,4],[4,4],[6,4],[2,6],[4,6],[6,6]],
	protect: [[3,1],[4,1],[5,1],[2,2],[6,2],[2,3],[6,3],[2,4],[6,4],[3,5],[5,5],[4,6],[4,3],[4,4]],
	restore: [[3,1],[4,1],[5,1],[2,2],[6,2],[6,3],[4,3],[5,3],[2,4],[3,5],[4,6],[5,6]]
};
export function toolIcon(tool, active) {
	const grid = 9, px = 3, pad = 3, size = grid * px + pad * 2;
	const cv = document.createElement('canvas'); cv.width = size; cv.height = size; cv.className = 'tool-ico';
	const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, size, size);
	ctx.fillStyle = active ? '#ffffff' : '#4b5563';
	for (const [x, y] of (ICON_BITS[tool] || ICON_BITS.pixel)) ctx.fillRect(pad + x * px, pad + y * px, px, px);
	return cv;
}
export const TOOL_META = {
	pixel: { label: 'Пиксель', key: 'E' },
	brush2: { label: 'Кисть 2×2', key: 'B' },
	brush3: { label: 'Кисть 3×3', key: '3' },
	line: { label: 'Линия', key: 'L' },
	rect: { label: 'Прямоугольник', key: 'R' },
	fill: { label: 'Заливка', key: 'F' },
	picker: { label: 'Пипетка', key: 'P' },
	move: { label: 'Перенос' },
	copy: { label: 'Копия' },
	stamp: { label: 'Штамп' },
	template: { label: 'Шаблон' },
	protect: { label: 'Защита' },
	restore: { label: 'Восстановить' }
};
export const KEY_MAP = { 'e': 'pixel', '1': 'pixel', 'b': 'brush2', '2': 'brush2', '3': 'brush3', 'l': 'line', 'r': 'rect', 'f': 'fill', 'p': 'picker' };
export function openWizard(api, config, onCreated) {
	const presets = config.presets || {};
	const state = { captchaToken: null };
	const presetSel = el('select', { class: 'input' }, ...Object.entries(presets).map(([k, v]) => el('option', { value: k }, v.title || k)));
	const name = el('input', { class: 'input', placeholder: 'Название мира', maxlength: '48' });
	const desc = el('input', { class: 'input', placeholder: 'Короткое описание', maxlength: '240' });
	const width = el('input', { class: 'input', type: 'number', value: '128', min: '32', max: '512' });
	const height = el('input', { class: 'input', type: 'number', value: '96', min: '32', max: '512' });
	const access = el('select', { class: 'input' }, ...(config.accessModes || ['public']).map((m) => el('option', { value: m }, m)));
	const captchaQ = el('span', { class: 'captcha-q' }, '…');
	const captchaA = el('input', { class: 'input', placeholder: 'Ответ', style: 'max-width:120px' });
	const refreshCaptcha = async () => { const c = await api.captcha(); state.captchaToken = c.captchaToken; captchaQ.textContent = c.question; };
	refreshCaptcha();
	const body = el('div', { class: 'form' },
		el('label', {}, 'Пресет', presetSel),
		el('label', {}, 'Название', name),
		el('label', {}, 'Описание', desc),
		el('div', { class: 'row' }, el('label', {}, 'Ширина', width), el('label', {}, 'Высота', height)),
		el('label', {}, 'Доступ', access),
		el('label', {}, 'Проверка', el('div', { class: 'row' }, captchaQ, captchaA, el('button', { class: 'icon-btn', type: 'button', onclick: refreshCaptcha }, '↻'))),
		el('p', { class: 'muted small' }, 'Мир создаётся в песочнице сообщества.')
	);
	modal('Создание мира', body, [
		{ label: 'Отмена', onClick: (close) => close() },
		{ label: 'Создать', primary: true, onClick: async (close) => {
			try {
				const world = await api.createWorld({ preset: presetSel.value, name: name.value, description: desc.value, width: +width.value, height: +height.value, access: { mode: access.value }, captchaToken: state.captchaToken, captcha: captchaA.value });
				toast('Мир создан', 'success'); close(); onCreated(world.world);
			} catch (err) { toast(err.message, 'error'); refreshCaptcha(); }
		} }
	]);
}
export function authModal(api, onAuth) {
	let mode = 'login';
	const nick = el('input', { class: 'input', placeholder: 'Ник', maxlength: '24' });
	const pass = el('input', { class: 'input', type: 'password', placeholder: 'Пароль' });
	const title = el('h3', {}, 'Вход');
	const submit = el('button', { class: 'btn btn-primary', onclick: async () => {
		try {
			const r = mode === 'login' ? await api.login(nick.value.trim(), pass.value) : await api.register(nick.value.trim(), pass.value);
			toast(mode === 'login' ? 'С возвращением!' : 'Аккаунт создан', 'success');
			back.remove(); onAuth(r.me);
		} catch (err) { toast(err.message, 'error'); }
	} }, 'Войти');
	const toggle = el('button', { class: 'link-btn', onclick: () => {
		mode = mode === 'login' ? 'register' : 'login';
		title.textContent = mode === 'login' ? 'Вход' : 'Регистрация';
		submit.textContent = mode === 'login' ? 'Войти' : 'Зарегистрироваться';
		toggle.textContent = mode === 'login' ? 'Нет аккаунта? Создать' : 'Уже есть аккаунт? Войти';
	} }, 'Нет аккаунта? Создать');
	const back = el('div', { class: 'modal-back' });
	const box = el('div', { class: 'modal' },
		el('div', { class: 'modal-head' }, title, el('button', { class: 'icon-btn', onclick: () => back.remove() }, '✕')),
		el('div', { class: 'modal-body' }, el('div', { class: 'form' }, nick, pass, submit, toggle))
	);
	back.appendChild(box);
	back.addEventListener('click', (e) => { if (e.target === back) back.remove(); });
	document.body.appendChild(back);
}
