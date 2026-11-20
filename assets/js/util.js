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

/* The reasons a MediaWiki upload was refused, in the old URL2Commons wording.
   `res.upload.warnings` is what users need; a bare "ERROR:" is not. */
Magpie.uploadFailure = function (result) {
	const res = (result && result.res) || {};
	const upload = res.upload || {};
	const warnings = upload.warnings;
	const file = (name) => String(name == null ? '' : name).replace(/^File:/, '');

	if (warnings) {
		const parts = [];
		const known = new Set();
		const take = (key) => {
			known.add(key);
			return Object.prototype.hasOwnProperty.call(warnings, key) ? warnings[key] : undefined;
		};
		let value;
		if ((value = take('duplicate')) !== undefined && value.length) {
			parts.push('the identical file is already on Commons as ' + file(value[0]));
		}
		if ((value = take('exists')) !== undefined) parts.push('a different file already uses this name: ' + file(value));
		if ((value = take('exists-normalized')) !== undefined) parts.push('a file with an equivalent name exists: ' + file(value));
		if ((value = take('duplicate-archive')) !== undefined) parts.push('an identical file was uploaded and deleted before: ' + file(value));
		if ((value = take('was-deleted')) !== undefined) parts.push('this filename was deleted before: ' + file(value));
		if ((value = take('badfilename')) !== undefined) parts.push('Commons would rename this file to "' + value + '"');
		if (take('emptyfile') !== undefined) parts.push('the file downloaded from the source URL was empty (the source may block automated downloads)');
		const unwanted = take('filetype-unwanted-type');
		const banned = take('filetype-banned');
		if (unwanted !== undefined || banned !== undefined) parts.push('this file type is not allowed on Commons');
		if (take('large-file') !== undefined) parts.push('the file is larger than Commons allows');
		if (take('was-deleted-archive') !== undefined) parts.push('an earlier version of this file was deleted');
		Object.keys(warnings).forEach((key) => {
			if (known.has(key)) return;
			let extra = key;
			if (warnings[key] !== '' && warnings[key] !== true) extra += ': ' + JSON.stringify(warnings[key]);
			parts.push(extra);
		});
		if (parts.length) return 'Not uploaded: ' + parts.join('; ') + '.';
	}

	if (res.error) {
		const info = res.error.info || res.error.code || '';
		if (info) {
			return 'ERROR: ' + info + (res.error.code && res.error.info ? ' [' + res.error.code + ']' : '');
		}
	}

	const error = result && result.error;
	if (error && error !== 'OK') return 'ERROR: ' + error;
	return 'ERROR: the upload failed, but Commons gave no reason. Please retry; if it keeps failing, report this URL.';
};

/* PHP's get_request() truthiness for a checkbox or flag parameter. */
Magpie.flag = function (value) {
	if (value === null || value === undefined) return false;
	const text = String(value).trim().toLowerCase();
	return text !== '' && text !== '0' && text !== 'false';
};
