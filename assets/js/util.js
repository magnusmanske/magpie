/* Small helpers shared by the views. Everything runs in the browser. */

window.Magpie = window.Magpie || {};

Magpie.escape = function (text) {
	return String(text == null ? '' : text);
};

Magpie.sleep = function (ms) {
	return new Promise(function (resolve) { setTimeout(resolve, ms); });
};

Magpie.ucfirst = function (text) {
	text = String(text || '');
	return text.charAt(0).toUpperCase() + text.slice(1);
};

/* A MediaWiki file name: spaces to underscores, first letter upper case.
   Mirrors FileName in the Rust crate for previews only; the server decides. */
Magpie.fileName = function (name) {
	name = String(name || '').trim().replace(/^(File|Image):/i, '').trim();
	return Magpie.ucfirst(name.replace(/ /g, '_'));
};

Magpie.commonsPage = function (name) {
	return 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(String(name).replace(/ /g, '_'));
};

/* Replace the placeholders url2commons accepted. */
Magpie.fillDescription = function (template, values) {
	return String(template || '')
		.replace(/\$DESCRIPTOR\$/g, values.descriptor || '')
		.replace(/\$URL\$/g, values.url || '')
		.replace(/\$NL\$/g, '\n')
		.replace(/\$US\$/g, '_')
		.replace(/\[\[Category:\]\]/g, '')
		.trim();
};

/* Parse lines of "url [name] [| descriptor]". */
Magpie.parseUrlLines = function (text) {
	return String(text || '').split('\n').map(function (line) {
		line = line.trim();
		if (!line) return null;
		const bar = line.indexOf('|');
		const descriptor = bar >= 0 ? line.slice(bar + 1).trim() : '';
		const head = (bar >= 0 ? line.slice(0, bar) : line).trim();
		const parts = head.split(/\s+/);
		const url = parts.shift();
		return { url: url, name: parts.join(' '), descriptor: descriptor };
	}).filter(Boolean);
};

/* Extract the fields of a {{Template|...}} from wikitext, for previews. */
Magpie.templateFields = function (text, name) {
	const start = String(text || '').toLowerCase().indexOf('{{' + name.toLowerCase());
	if (start < 0) return null;
	let depth = 0, index = start;
	while (index < text.length) {
		if (text.startsWith('{{', index)) { depth++; index += 2; continue; }
		if (text.startsWith('}}', index)) { depth--; index += 2; if (depth === 0) break; continue; }
		index++;
	}
	const body = text.slice(start + 2, index - 2);
	const parts = [];
	let current = '', nested = 0;
	for (let i = 0; i < body.length; i++) {
		if (body.startsWith('{{', i)) { nested++; current += '{{'; i++; continue; }
		if (body.startsWith('}}', i)) { nested--; current += '}}'; i++; continue; }
		if (body[i] === '|' && nested === 0) { parts.push(current); current = ''; continue; }
		current += body[i];
	}
	parts.push(current);
	parts.shift();
	return { fields: parts, before: text.slice(0, start), after: text.slice(index) };
};

Magpie.statusClass = function (status) {
	if (status === 'done') return 'good';
	if (status === 'error') return 'bad';
	return 'uploading';
};
