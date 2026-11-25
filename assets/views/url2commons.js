Magpie.Views = Magpie.Views || {};

/* A fallback only; the live list comes from Commons, which keeps adding
   permitted extensions. */
const URL2C_FALLBACK_TYPES = [
	'png', 'gif', 'jpg', 'jpeg', 'tiff', 'tif', 'xcf', 'pdf', 'mid', 'midi',
	'mp3', 'mpeg', 'mpg', 'ogg', 'ogv', 'svg', 'djvu', 'oga', 'flac', 'opus',
	'stl', 'wav', 'webm', 'webp'
];

Magpie.Views.url2commons = {
	template: `
	<div>
		<div class="magpie-card">
			<h2>{{ t('magpie_tool_url2commons') }}</h2>
			<div v-if="auth.checked && !auth.ok" class="magpie-card">
				<strong>{{ t('magpie_not_logged_in') }}</strong>
				<a :href="authorizeUrl">{{ t('magpie_login_to_upload') }}</a>
			</div>
			<div class="magpie-field">
				<label for="u2c-urls">{{ t('magpie_urls') }}</label>
				<textarea id="u2c-urls" v-model="urls" rows="6" class="form-control magpie-mono"></textarea>
				<p class="magpie-hint">{{ t('magpie_urls_hint') }}</p>
			</div>
			<div class="magpie-field">
				<label for="u2c-desc">{{ t('magpie_description_template') }}</label>
				<textarea id="u2c-desc" v-model="description" rows="9" class="form-control magpie-mono"></textarea>
				<p class="magpie-hint">{{ t('magpie_desc_hint') }}</p>
			</div>
			<div class="magpie-row">
				<button class="btn btn-primary" :disabled="working" @click="simulate(true)">{{ t('magpie_simulate') }}</button>
				<button class="btn btn-outline-secondary" :disabled="working" @click="previewDescription">{{ t('magpie_preview_description') }}</button>
				<button v-if="canUpload" class="btn btn-success" @click="simulate(false)">{{ t('magpie_upload') }}</button>
			</div>
			<p v-if="message" class="magpie-status magpie-error">{{ message }}</p>
			<p v-if="summary" class="magpie-status" :class="summaryClass">{{ summary }}</p>
		</div>

		<div class="magpie-card" v-if="previewHtml">
			<h3>{{ t('magpie_description_preview') }}</h3>
			<p class="magpie-hint">{{ previewMessage }}</p>
			<div class="url2c-preview" v-html="previewHtml"></div>
		</div>

		<div class="magpie-card" v-if="items.length">
			<h3>{{ t('magpie_files') }}</h3>
			<table class="magpie-table">
				<thead><tr><th>{{ t('magpie_file_name') }}</th><th>{{ t('magpie_source') }}</th><th>{{ t('magpie_status') }}</th></tr></thead>
				<tbody>
					<tr v-for="item in items" :key="item.id">
						<td>
							<span class="magpie-mono">{{ item.newname || '(from URL)' }}</span>
							<pre v-if="item.desc" class="url2c-desc">{{ item.desc }}</pre>
						</td>
						<td class="url">{{ item.sourceUrl }}</td>
						<td class="magpie-status" :class="statusClass(item)">
							<span v-if="item.page"><a :href="item.page" target="_blank" rel="noopener">{{ t('magpie_uploaded') }}</a></span>
							<span v-else>{{ item.message || statusLabel(item) }}</span>
						</td>
					</tr>
				</tbody>
			</table>
		</div>
	</div>`,
	data() {
		return {
			auth: Magpie.authState,
			authorizeUrl: Magpie.api.authorizeUrl(),
			urls: '',
			description: '=={{int:filedesc}}==\n{{Information\n| Description    = {{en|$DESCRIPTOR$}}\n| Date           =\n| Source         = $URL$\n| Author         =\n| Permission     =\n| Other_versions =\n}}\n\n[[Category:]]',
			items: [],
			message: '',
			previewHtml: '',
			previewMessage: '',
			allowedTypes: URL2C_FALLBACK_TYPES.slice(),
			simulated: false,
			simulating: false,
			uploading: false,
			badCount: 0,
			mode: 'simulate'
		};
	},
	computed: {
		working() {
			return this.simulating || this.uploading;
		},
		canUpload() {
			return this.auth.ok && this.simulated && !this.working
				&& this.items.length > 0
				&& this.items.every((item) => item.status === 'ok');
		},
		summary() {
			if (this.working || !this.items.length) return '';
			if (this.badCount > 0) {
				const key = this.mode === 'simulate'
					? (this.badCount === 1 ? 'magpie_simulation_failed' : 'magpie_simulations_failed')
					: (this.badCount === 1 ? 'magpie_upload_failed_count' : 'magpie_uploads_failed');
				return this.t(key, [this.badCount]);
			}
			if (this.mode === 'upload') {
				return this.items.every((item) => item.status === 'done') ? this.t('magpie_all_uploaded') : '';
			}
			return this.t('magpie_all_simulations_ok');
		},
		summaryClass() {
			return this.badCount > 0 ? 'magpie-error' : 'magpie-ok';
		}
	},
	async mounted() {
		await Promise.all([Magpie.refreshAuth(), this.loadAllowedFileTypes()]);
		// A form POST hands its values over once; do not replay them when the
		// view is mounted again during client-side navigation.
		const bootstrap = window.__MAGPIE_BOOTSTRAP__ || null;
		if (bootstrap) delete window.__MAGPIE_BOOTSTRAP__;
		const params = this.getUrlVars();
		if (params.oauth_error) {
			this.message = this.t('magpie_login_failed');
		}
		if (bootstrap) {
			if (bootstrap.interface_language) {
				await Magpie.i18n.setLanguage(bootstrap.interface_language);
			}
			if (bootstrap.urls !== undefined) this.urls = bootstrap.urls;
			if (bootstrap.desc !== undefined) this.description = bootstrap.desc;
			if (bootstrap.run) {
				if (!this.auth.ok) {
					this.message = this.t('magpie_login_required');
					await this.simulate(true);
				} else {
					await this.simulate(false);
				}
			} else if (bootstrap.simulate) {
				await this.simulate(true);
			}
			return;
		}
		if (params.urls !== undefined) this.urls = params.urls;
		if (params.desc !== undefined) this.description = params.desc;
		if (params.run !== undefined) {
			if (!this.auth.ok) {
				this.message = this.t('magpie_login_required');
				await this.simulate(true);
			} else {
				await this.simulate(false);
			}
		} else if (params.simulate !== undefined) {
			await this.simulate(true);
		}
	},
	methods: {
		statusClass(item) {
			if (item.status === 'ok' || item.status === 'done') return 'good';
			if (item.status === 'error') return 'bad';
			return 'uploading';
		},
		statusLabel(item) {
			if (item.status === 'checking') return this.t('magpie_checking');
			if (item.status === 'uploading') return this.t('magpie_uploading');
			if (item.status === 'ok') return this.t('magpie_filename_available');
			return '';
		},
		/* PHP's getUrlVars(): the fragment wins, and "_" means a space. */
		getUrlVars() {
			const vars = {};
			let query = '';
			const hash = window.location.hash || '';
			if (hash.length > 1) query = hash.slice(1);
			if (!query) query = window.location.search.replace(/^\?/, '');
			if (!query) return vars;
			new URLSearchParams(query).forEach((value, key) => {
				vars[key] = value.replace(/_/g, ' ');
			});
			return vars;
		},
		async loadAllowedFileTypes() {
			try {
				const url = new URL('https://commons.wikimedia.org/w/api.php');
				url.search = new URLSearchParams({
					action: 'query',
					meta: 'siteinfo',
					siprop: 'fileextensions',
					format: 'json',
					origin: '*'
				}).toString();
				const response = await fetch(url);
				if (!response.ok) return;
				const data = await response.json();
				const list = ((data.query || {}).fileextensions || [])
					.map((entry) => String(entry.ext || '').toLowerCase())
					.filter(Boolean);
				if (list.length) this.allowedTypes = list;
			} catch (error) {
				/* Keep the fallback list. */
			}
		},
		parseLine(line, id) {
			line = String(line || '').trim();
			if (!line) return null;
			let match = line.match(/^(\S+)\s(.*?)\|(.*)$/);
			if (!match) match = line.match(/^(\S+)\s(.*)$/);
			if (!match) match = line.match(/^(\S+)$/);
			if (!match) return null;
			return {
				id: 'url_' + id,
				sourceUrl: match[1].replace(/\$US\$/g, '_'),
				newname: match[2] || '',
				descriptor: match[3] || '',
				desc: '',
				status: 'checking',
				message: '',
				page: ''
			};
		},
		rows() {
			return String(this.urls || '').split('\n')
				.map((line, index) => this.parseLine(line, index))
				.filter(Boolean);
		},
		async simulate(upload) {
			if (this.working) return;
			this.message = '';
			this.previewHtml = '';
			this.mode = upload ? 'upload' : 'simulate';
			this.items = this.rows();
			this.badCount = 0;
			this.simulated = false;
			if (!this.items.length) {
				this.message = this.t('magpie_enter_url');
				return;
			}

			const seenUrls = new Set();
			const seenNames = new Set();
			this.simulating = true;
			for (const item of this.items) {
				if (item.status === 'error') {
					this.badCount++;
					continue;
				}
				await this.checkItem(item, seenUrls, seenNames);
				if (item.status === 'error') this.badCount++;
			}
			this.simulating = false;
			if (upload && this.badCount === 0) await this.uploadAll();
			else this.simulated = !upload && this.badCount === 0;
		},
		async checkItem(item, seenUrls, seenNames) {
			try {
				if (seenUrls.has(item.sourceUrl)) {
					return this.fail(item, this.t('magpie_duplicate_url'));
				}
				seenUrls.add(item.sourceUrl);

				if (item.newname === '') {
					const parts = item.sourceUrl.split('/');
					item.newname = parts.pop();
				}
				item.newname = item.newname.replace(/^\s*(File|Image)\s*:\s*/i, '');

				const type = item.newname.split('.').pop().toLowerCase().trim();
				if (!this.allowedTypes.includes(type)) {
					return this.fail(item, this.t('magpie_unsupported_type', [type]));
				}
				if (seenNames.has(item.newname)) {
					return this.fail(item, this.t('magpie_duplicate_filename'));
				}
				seenNames.add(item.newname);

				item.desc = Magpie.fillDescription(this.description, {
					url: item.sourceUrl,
					descriptor: item.descriptor
				});

				const answer = await Magpie.api.flickrExisting([item.newname]);
				if (answer.status !== 'OK') {
					return this.fail(item, this.t('magpie_could_not_check_filename'));
				}
				const status = ((answer.data || {}).files || {})[Magpie.fileName(item.newname)];
				if (status === 1) {
					return this.fail(item, this.t('magpie_filename_exists_on_commons', [item.newname]));
				}
				item.status = 'ok';
				item.message = this.t('magpie_filename_available');
			} catch (error) {
				this.fail(item, this.t('magpie_could_not_check_file', [String(error.message || error)]));
			}
		},
		fail(item, message) {
			item.status = 'error';
			item.message = message;
			return item;
		},
		async uploadAll() {
			this.uploading = true;
			this.simulated = false;
			for (const item of this.items) {
				item.status = 'uploading';
				item.message = this.t('magpie_uploading_file');
				try {
					const result = await Magpie.api.uploadFromUrl({
						url: item.sourceUrl,
						newfile: item.newname,
						desc: item.desc,
						comment: 'Transferred from ' + item.sourceUrl + ' using URL2Commons',
						ignorewarnings: false,
						blockwarnings: ''
					});
					if (result.error && result.error !== 'OK') {
						item.status = 'error';
						item.message = Magpie.uploadFailure(result);
						this.badCount++;
					} else {
						const uploaded = result.res && result.res.upload && result.res.upload.filename;
						item.status = 'done';
						item.page = Magpie.commonsPage(uploaded || item.newname);
						item.message = this.t('magpie_upload_success');
					}
				} catch (error) {
					item.status = 'error';
					item.message = this.t('magpie_upload_request_failed', [String(error.message || error)]);
					this.badCount++;
				}
				await Magpie.sleep(300);
			}
			this.uploading = false;
		},
		async previewDescription() {
			this.previewHtml = '';
			let first = null;
			for (const item of this.rows()) {
				first = item;
				break;
			}
			this.previewMessage = first
				? this.t('magpie_preview_first_url')
				: this.t('magpie_preview_no_url');

			const text = Magpie.fillDescription(this.description, {
				url: first ? first.sourceUrl : '',
				descriptor: first ? first.descriptor : ''
			});
			try {
				const response = await fetch('https://commons.wikimedia.org/w/api.php', {
					method: 'POST',
					headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
					body: new URLSearchParams({
						action: 'parse',
						format: 'json',
						contentmodel: 'wikitext',
						prop: 'text',
						origin: '*',
						disableeditsection: '1',
						title: 'File:Example.jpg',
						text: text
					}).toString()
				});
				if (!response.ok) throw new Error('HTTP ' + response.status);
				const data = await response.json();
				const html = ((data.parse || {}).text || {})['*'];
				if (html === undefined) {
					this.previewMessage = ((data.error || {}).info) || this.t('magpie_preview_could_not_render');
					return;
				}
				this.previewHtml = this.sanitizePreview(html);
			} catch (error) {
				this.previewMessage = this.t('magpie_preview_unreachable');
			}
		},
		/* Commons sanitises parsed wikitext, but never trust HTML from a
		   user-controlled description in our own document. */
		sanitizePreview(html) {
			const doc = new DOMParser().parseFromString(html, 'text/html');
			doc.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,button').forEach((node) => node.remove());
			doc.querySelectorAll('*').forEach((node) => {
				Array.from(node.attributes).forEach((attribute) => {
					const name = attribute.name.toLowerCase();
					if (name.startsWith('on')) node.removeAttribute(attribute.name);
					if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(attribute.value)) {
						node.removeAttribute(attribute.name);
					}
				});
			});
			doc.querySelectorAll('a[href^="/"]').forEach((link) => {
				link.setAttribute('href', 'https://commons.wikimedia.org' + link.getAttribute('href'));
				link.setAttribute('target', '_blank');
				link.setAttribute('rel', 'noopener');
			});
			return doc.body.innerHTML;
		}
	}
};
