Magpie.Views = Magpie.Views || {};

Magpie.Views.commonshelper = {
	template: `
	<div>
		<div class="magpie-card">
			<h2>{{ t('magpie_tool_commonshelper') }}</h2>
			<p class="magpie-hint">{{ t('magpie_ch_intro') }}</p>
			<div v-if="auth.checked && !auth.ok" class="magpie-card">
				<strong>{{ t('magpie_not_logged_in') }}</strong>
				<a :href="authorizeUrl">{{ t('magpie_login_to_upload') }}</a>
			</div>
			<div class="magpie-row">
				<div class="magpie-field">
					<label>{{ t('magpie_language') }}</label>
					<input v-model="language" class="form-control magpie-mono" size="6">
				</div>
				<div class="magpie-field">
					<label>{{ t('magpie_project') }}</label>
					<input v-model="project" class="form-control magpie-mono" size="10">
				</div>
				<div class="magpie-field">
					<label>{{ t('magpie_file_on_wiki') }}</label>
					<input v-model="image" class="form-control" :placeholder="t('magpie_file_name')">
				</div>
				<div class="magpie-field">
					<label>{{ t('magpie_new_name') }}</label>
					<input v-model="newname" class="form-control" :placeholder="image">
				</div>
			</div>
			<div class="magpie-field">
				<label for="ch-categories">{{ t('magpie_extra_categories') }}</label>
				<textarea id="ch-categories" v-model="extraCategories" rows="3" class="form-control"></textarea>
			</div>
			<div class="magpie-row">
				<label class="magpie-check"><input type="checkbox" v-model="removeCategories"> {{ t('magpie_remove_source_categories') }}</label>
				<label class="magpie-check"><input type="checkbox" v-model="ignorewarnings"> {{ t('magpie_ignore_warnings') }}</label>
				<label class="magpie-check"><input type="checkbox" v-model="directUpload"> {{ t('magpie_direct_upload') }}</label>
			</div>
			<div class="magpie-row">
				<button class="btn btn-primary" :disabled="loading" @click="translate">{{ t('magpie_get_text') }}</button>
				<button v-if="directUpload" class="btn btn-success"
					:disabled="!text || !isGood || uploading || loading" @click="upload">{{ t('magpie_upload_to_commons') }}</button>
				<span v-else class="magpie-hint">{{ t('magpie_use_manual_upload') }}</span>
			</div>
			<p v-if="message" class="magpie-status magpie-error">{{ message }}</p>
			<p v-if="warnings.length" class="magpie-status magpie-error">
				<span v-for="warning in warnings" :key="warning">{{ warning }}<br></span>
			</p>
		</div>

		<div class="magpie-card">
			<h3>{{ t('magpie_batch_heading') }}</h3>
			<p class="magpie-hint">{{ t('magpie_batch_hint') }}</p>
			<div class="magpie-field">
				<label for="ch-batch-files">{{ t('magpie_batch_files') }}</label>
				<textarea id="ch-batch-files" v-model="batchImages" rows="5" class="form-control magpie-mono"></textarea>
			</div>
			<div class="magpie-actions">
				<button class="btn btn-primary" :disabled="batchBusy || !batchImages.trim()" @click="translateAll">
					{{ batchBusy ? t('magpie_loading') : t('magpie_batch_translate') }}</button>
				<button class="btn btn-success" :disabled="batchBusy || !batchReadyCount" @click="uploadAll">
					{{ t('magpie_batch_upload') }}</button>
			</div>
			<p v-if="batchMessage" class="magpie-status" aria-live="polite">{{ batchMessage }}</p>
			<table v-if="batchRows.length" class="magpie-table mt-2">
				<thead><tr>
					<th>{{ t('magpie_file_name') }}</th>
					<th>{{ t('magpie_new_name') }}</th>
					<th>{{ t('magpie_status') }}</th>
				</tr></thead>
				<tbody>
					<tr v-for="row in batchRows" :key="row.image">
						<td class="magpie-mono">{{ row.image }}
							<details v-if="row.text">
								<summary>{{ t('description') }}</summary>
								<textarea v-model="row.text" rows="10" class="form-control magpie-mono"></textarea>
							</details>
						</td>
						<td><input v-model="row.newname" class="form-control magpie-mono"
							:disabled="row.status === 'uploading' || row.status === 'done'"></td>
						<td class="magpie-status">
							<span :class="batchRowClass(row)">{{ batchRowStatus(row) }}</span>
							<small v-if="row.warnings.length" class="magpie-error">{{ row.warnings.join('; ') }}</small>
							<span v-if="row.page"><a :href="row.page" target="_blank" rel="noopener">{{ t('magpie_uploaded') }}</a></span>
						</td>
					</tr>
				</tbody>
			</table>
		</div>

		<div class="magpie-card" v-if="text">
			<h3>{{ t('description') }}</h3>
			<p class="magpie-hint">
				<span v-if="isGood" class="magpie-ok">{{ t('magpie_free_license_recognised') }}</span>
				<span v-else class="magpie-error">{{ t('magpie_no_free_license') }}</span>
			</p>
			<textarea v-model="text" rows="20" class="form-control magpie-mono"></textarea>
			<div class="magpie-actions">
				<a class="btn btn-outline-secondary" :href="sourceUrl" target="_blank" rel="noopener">{{ t('magpie_source_file') }}</a>
				<form :action="commonsUploadUrl" method="post" enctype="multipart/form-data"
					target="_blank" rel="noopener" class="d-inline">
					<input type="hidden" name="wpUploadDescription" :value="text">
					<button type="submit" class="btn btn-outline-secondary">{{ t('magpie_manual_upload') }}</button>
				</form>
				<button class="btn btn-outline-secondary" @click="copyText">{{ t('magpie_copy_text') }}</button>
			</div>
			<p v-if="page" class="magpie-ok">{{ t('magpie_uploaded_at') }} <a :href="page" target="_blank">{{ page }}</a></p>
			<p v-if="uploadMessage" class="magpie-status" :class="page ? 'good' : 'bad'">{{ uploadMessage }}</p>
		</div>

		<div class="magpie-card" v-if="page">
			<h3>{{ t('magpie_nowcommons_heading') }}</h3>
			<p>{{ t('magpie_add_to_original') }}</p>
			<textarea readonly rows="2" class="form-control magpie-mono">{{ nowCommons }}</textarea>
			<p class="magpie-actions">
				<button class="btn btn-primary" :disabled="nowCommonsBusy || !auth.ok" @click="applyNowCommons">
					{{ t('magpie_add_nowcommons') }}</button>
				<a class="btn btn-outline-secondary" :href="sourceEditUrl" target="_blank" rel="noopener">{{ t('magpie_edit_original') }}</a>
				<a class="btn btn-outline-danger" :href="deleteUrl" target="_blank" rel="noopener">{{ t('magpie_delete_original') }}</a>
			</p>
			<p v-if="nowCommonsMessage" class="magpie-status" :class="nowCommonsError ? 'bad' : 'good'">{{ nowCommonsMessage }}</p>
		</div>
	</div>`,
	data() {
		return {
			auth: Magpie.authState,
			authorizeUrl: Magpie.api.authorizeUrl(),
			language: 'en',
			project: 'wikipedia',
			image: '',
			newname: '',
			extraCategories: '',
			removeCategories: false,
			ignorewarnings: false,
			directUpload: true,
			autoDirect: false,
			// Accepted for compatibility with the PHP tool; the interface is English.
			interfaceLanguage: 'en',
			loading: false,
			uploading: false,
			message: '',
			uploadMessage: '',
			warnings: [],
			text: '',
			isGood: false,
			sourceUrl: '',
			page: '',
			nameCollision: false,
			renamedFrom: '',
			nowCommonsBusy: false,
			nowCommonsMessage: '',
			nowCommonsError: false,
			batchImages: '',
			batchRows: [],
			batchBusy: false,
			batchMessage: ''
		};
	},
	computed: {
		bareImage() {
			return this.image.trim().replace(/^(File|Image):/i, '').trim();
		},
		effectiveName() {
			return this.newname.trim() || this.bareImage;
		},
		site() {
			return this.language + '.' + this.project + '.org';
		},
		sourcePageUrl() {
			return 'https://' + this.site + '/wiki/File:' +
				encodeURIComponent(this.bareImage.replace(/ /g, '_'));
		},
		sourceEditUrl() {
			return 'https://' + this.site + '/w/index.php?title=File:' +
				encodeURIComponent(this.bareImage.replace(/ /g, '_')) + '&action=edit';
		},
		commonsUploadUrl() {
			return 'https://commons.wikimedia.org/wiki/Special:Upload';
		},
		nowCommons() {
			const english = this.language === 'en';
			const template = english ? 'subst:ncd' : 'NowCommons';
			const prefix = english ? 'File:' : '';
			if (this.bareImage === this.effectiveName) return '{{' + template + '}}';
			return '{{' + template + '|' + prefix + this.effectiveName + '}}';
		},
		deleteUrl() {
			const title = encodeURIComponent('File:' + this.bareImage.replace(/ /g, '_'));
			const reason = encodeURIComponent('NowCommons [[:commons:File:' + this.effectiveName + ']]');
			return 'https://' + this.site + '/w/index.php?title=' + title +
				'&action=delete&wpReason=' + reason;
		},
		batchReadyCount() {
			return this.batchRows.filter((row) =>
				row.status === 'ready' && row.isGood && row.text.trim() !== '').length;
		}
	},
	async mounted() {
		await Magpie.refreshAuth();
		const params = new URLSearchParams(window.location.search);
		this.applyQuery(params);
		if (!this.image) return;
		const translated = await this.translate();
		if (!params.has('doit') || !this.autoDirect) return;
		if (!this.auth.ok) {
			this.uploadMessage = this.t('magpie_login_before_direct');
		} else if (!this.isGood) {
			this.uploadMessage = this.t('magpie_no_free_license_not_uploading');
		} else if (translated && (!this.nameCollision || this.ignorewarnings)) {
			await this.upload();
		} else if (translated && this.nameCollision) {
			this.uploadMessage = this.t('magpie_name_changed_review');
		}
	},
	methods: {
		applyQuery(params) {
			const language = (params.get('language') || '').trim();
			const lang = (params.get('lang') || '').trim();
			if (language) this.language = language;
			else if (lang) this.language = lang;
			if (params.has('project')) this.project = (params.get('project') || '').trim();
			if (params.has('image')) this.image = (params.get('image') || '').trim();
			if (params.has('newname')) this.newname = (params.get('newname') || '').trim();
			if (params.has('ignorewarnings')) this.ignorewarnings = Magpie.flag(params.get('ignorewarnings'));
			if (params.has('remove_categories')) this.removeCategories = params.get('remove_categories') !== '0';
			if (params.has('directupload') || params.has('reallydirectupload')) {
				this.autoDirect = Magpie.flag(params.get('directupload'))
					|| Magpie.flag(params.get('reallydirectupload'));
				this.directUpload = this.autoDirect;
			}
			this.interfaceLanguage = (params.get('interface') || 'en').toLowerCase();
		},
		async translate() {
			this.message = '';
			this.uploadMessage = '';
			this.page = '';
			this.warnings = [];
			this.nameCollision = false;
			this.renamedFrom = '';
			if (!this.bareImage) {
				this.message = this.t('magpie_enter_file_name');
				return false;
			}
			this.loading = true;
			try {
				const data = await this.translateFile(this.bareImage, this.newname.trim());
				this.text = this.addExtraCategories(data.text || '');
				this.isGood = !!data.is_good;
				this.warnings = data.warnings || [];
				this.sourceUrl = data.source_url || this.sourcePageUrl;
				if (!this.newname.trim() && data.newname) this.newname = data.newname;
				await this.resolveCommonsName();
				return true;
			} catch (error) {
				this.text = '';
				this.message = String(error.message || error);
				return false;
			} finally {
				this.loading = false;
			}
		},
		async translateFile(image, newname = '') {
			const query = new URLSearchParams({
				image,
				language: this.language.trim() || 'en',
				project: this.project.trim() || 'wikipedia',
				newname,
				remove_categories: this.removeCategories ? '1' : '0'
			});
			const response = await fetch('/commonshelper/translate?' + query.toString());
			const data = await response.json();
			if (data.error && data.error !== 'OK') throw new Error(data.error);
			return data;
		},
		addExtraCategories(text) {
			const categories = String(this.extraCategories || '').split('\n')
				.map((category) => category.trim()
					.replace(/^\[\[Category:/i, '')
					.replace(/^Category:/i, '')
					.replace(/\]\]$/, '')
					.trim())
				.filter(Boolean)
				.map((category) => '[[Category:' + category + ']]');
			if (categories.length === 0) return text;
			return text.trimEnd() + '\n' + categories.join('\n');
		},
		/* The PHP tool renames a colliding file to "<name> (1).<ext>",
		   " (2)" and so on; it never overwrites an existing file. */
		async resolveCommonsName() {
			const wanted = this.effectiveName;
			if (!wanted) return;
			const free = await this.freeCommonsName(wanted);
			if (!free.changed) return;
			this.newname = free.name;
			this.renamedFrom = wanted;
			this.nameCollision = true;
			this.warnings.unshift(this.t('magpie_name_changed', [wanted, free.name]));
		},
		async freeCommonsName(wanted) {
			let candidate = wanted;
			for (let count = 1; count <= 50; count++) {
				if (!(await this.commonsExists(candidate))) {
					return { name: candidate, changed: candidate !== wanted };
				}
				candidate = this.numberedName(wanted, count);
			}
			throw new Error(this.t('magpie_no_free_name', [wanted]));
		},
		numberedName(name, count) {
			const dot = name.lastIndexOf('.');
			if (dot <= 0) return name + ' (' + count + ')';
			return name.slice(0, dot) + ' (' + count + ')' + name.slice(dot);
		},
		async commonsExists(name) {
			const answer = await Magpie.api.flickrExisting([name]);
			if (!answer || answer.status !== 'OK') {
				throw new Error(this.t('magpie_could_not_check_filename'));
			}
			const status = ((answer.data || {}).files || {})[Magpie.fileName(name)];
			return status === 1;
		},
		batchImageList() {
			const seen = new Set();
			return String(this.batchImages || '').split('\n')
				.map((line) => line.trim().replace(/^(File|Image):/i, '').trim())
				.filter((image) => {
					if (!image || seen.has(image)) return false;
					seen.add(image);
					return true;
				});
		},
		batchRowStatus(row) {
			if (row.status === 'translating') return this.t('magpie_loading');
			if (row.status === 'uploading') return this.t('magpie_uploading');
			if (row.status === 'done') return this.t('magpie_uploaded');
			if (row.status === 'error') return row.message;
			return row.isGood ? this.t('magpie_ready') : this.t('magpie_no_free_license');
		},
		batchRowClass(row) {
			if (row.status === 'done') return 'good';
			if (row.status === 'error') return 'bad';
			if (row.status === 'ready' && !row.isGood) return 'bad';
			return 'uploading';
		},
		async translateAll() {
			const images = this.batchImageList();
			if (images.length === 0) {
				this.batchMessage = this.t('magpie_enter_file_name');
				return;
			}
			this.batchBusy = true;
			this.batchMessage = this.t('magpie_loading');
			const rows = images.map((image) => ({
				image,
				newname: image,
				text: '',
				isGood: false,
				warnings: [],
				sourceUrl: '',
				status: 'translating',
				message: '',
				page: ''
			}));
			this.batchRows = rows;
			for (let offset = 0; offset < rows.length; offset += 3) {
				await Promise.all(rows.slice(offset, offset + 3).map(async (row) => {
					try {
						const data = await this.translateFile(row.image);
						row.text = this.addExtraCategories(data.text || '');
						row.isGood = !!data.is_good;
						row.warnings = data.warnings || [];
						row.sourceUrl = data.source_url || '';
						const wanted = data.newname || row.image;
						const free = await this.freeCommonsName(wanted);
						row.newname = free.name;
						if (free.changed) {
							row.warnings.unshift(this.t('magpie_name_changed', [wanted, free.name]));
						}
						row.status = 'ready';
						row.message = row.isGood ? '' : this.t('magpie_no_free_license');
					} catch (error) {
						row.status = 'error';
						row.message = String(error.message || error);
					}
				}));
			}
			this.batchBusy = false;
			const good = rows.filter((row) => row.status === 'ready' && row.isGood).length;
			this.batchMessage = this.t('magpie_batch_translated', [rows.length, good]);
		},
		async uploadAll() {
			const rows = this.batchRows.filter((row) =>
				row.status === 'ready' && row.isGood && row.text.trim() !== '' && row.newname.trim() !== '');
			if (rows.length === 0) {
				this.batchMessage = this.t('magpie_batch_nothing');
				return;
			}
			if (!this.auth.ok) {
				this.batchMessage = this.t('magpie_login_required');
				return;
			}
			this.batchBusy = true;
			this.batchMessage = '';
			let done = 0;
			let failed = 0;
			let autopatrolled = false;
			try {
				const rights = await Magpie.api.getRights();
				if (rights.error && rights.error !== 'OK') throw new Error(rights.error);
				const groups = (((rights.result || {}).query || {}).userinfo || {}).groups || [];
				autopatrolled = groups.indexOf('autopatrolled') !== -1;
			} catch (error) {
				this.batchBusy = false;
				this.batchMessage = String(error.message || error);
				return;
			}
			for (const row of rows) {
				row.status = 'uploading';
				row.message = '';
				try {
					let description = row.text;
					if (!autopatrolled) description = this.botMoveToCommons() + '\n\n' + description;
					const result = await Magpie.api.uploadFromUrl({
						url: row.sourceUrl,
						newfile: row.newname.trim(),
						desc: description,
						comment: 'Transferred from ' + this.site + ' via #commonshelper',
						ignorewarnings: this.ignorewarnings,
						blockwarnings: ''
					});
					if (result.error && result.error !== 'OK') throw new Error(Magpie.uploadFailure(result));
					const uploaded = result.res && result.res.upload && result.res.upload.filename;
					row.page = Magpie.commonsPage(uploaded || row.newname);
					row.status = 'done';
					row.message = this.t('magpie_upload_success');
					done++;
				} catch (error) {
					row.status = 'error';
					row.message = String(error.message || error);
					failed++;
				}
				await Magpie.sleep(300);
			}
			this.batchBusy = false;
			this.batchMessage = this.t('magpie_batch_uploaded', [done, failed]);
		},
		async upload() {
			this.uploadMessage = '';
			this.page = '';
			if (!this.text.trim()) return;
			if (!this.isGood) {
				this.uploadMessage = this.t('magpie_no_free_license_not_uploading');
				return;
			}
			if (!this.sourceUrl) {
				this.uploadMessage = this.t('magpie_source_url_unknown');
				return;
			}
			this.uploading = true;
			try {
				let description = this.text;
				const rights = await Magpie.api.getRights();
				if (rights.error && rights.error !== 'OK') throw new Error(rights.error);
				const groups = (((rights.result || {}).query || {}).userinfo || {}).groups || [];
				const autopatrolled = groups.indexOf('autopatrolled') !== -1;
				if (!autopatrolled) description = this.botMoveToCommons() + '\n\n' + description;
				const result = await Magpie.api.uploadFromUrl({
					url: this.sourceUrl,
					newfile: this.effectiveName,
					desc: description,
					comment: 'Transferred from ' + this.language + '.' + this.project + ' via #commonshelper',
					ignorewarnings: this.ignorewarnings,
					blockwarnings: ''
				});
				if (result.error && result.error !== 'OK') throw new Error(Magpie.uploadFailure(result));
				const uploaded = result.res && result.res.upload && result.res.upload.filename;
				this.page = Magpie.commonsPage(uploaded || this.effectiveName);
				this.uploadMessage = this.t('magpie_upload_success');
			} catch (error) {
				this.uploadMessage = String(error.message || error);
			} finally {
				this.uploading = false;
			}
		},
		async applyNowCommons() {
			if (this.nowCommonsBusy) return;
			const title = 'File:' + this.bareImage.replace(/ /g, '_');
			if (!window.confirm(this.t('magpie_nowcommons_confirm', [this.nowCommons, title]))) return;
			this.nowCommonsBusy = true;
			this.nowCommonsMessage = '';
			this.nowCommonsError = false;
			try {
				const url = new URL('https://' + this.site + '/w/api.php');
				url.search = new URLSearchParams({
					action: 'query',
					titles: title,
					prop: 'revisions',
					rvprop: 'content|timestamp',
					rvslots: 'main',
					format: 'json',
					formatversion: '2',
					origin: '*'
				}).toString();
				const response = await fetch(url);
				if (!response.ok) throw new Error('HTTP ' + response.status);
				const data = await response.json();
				if (data.error) throw new Error(data.error.info || data.error.code || 'Could not read the page');
				const page = ((data.query || {}).pages || [])[0];
				const revision = page && page.revisions && page.revisions[0];
				const slot = revision && revision.slots && revision.slots.main;
				const content = slot && (slot.content !== undefined ? slot.content : slot['*']);
				const text = typeof content === 'string' ? content : '';
				if (text.indexOf(this.nowCommons) !== -1) {
					this.nowCommonsMessage = this.t('magpie_nowcommons_already');
					return;
				}
				const basetimestamp = (revision && revision.timestamp) || '';
				const answer = await Magpie.api.setPageText(
					title, this.nowCommons + '\n' + text, this.site, 'Now commons', basetimestamp);
				if (answer.error && answer.error !== 'OK') throw new Error(answer.error);
				this.nowCommonsMessage = this.t('magpie_nowcommons_added');
			} catch (error) {
				this.nowCommonsError = true;
				this.nowCommonsMessage = String(error.message || error);
			} finally {
				this.nowCommonsBusy = false;
			}
		},
		botMoveToCommons() {
			const now = new Date();
			const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
				'August', 'September', 'October', 'November', 'December'];
			return '{{BotMoveToCommons|' + this.language + '.' + this.project + '|year=' + now.getFullYear() +
				'|month=' + months[now.getMonth()] + '|day=' + now.getDate() + '}}';
		},
		async copyText() {
			try {
				await navigator.clipboard.writeText(this.text);
				this.uploadMessage = this.t('magpie_text_copied');
			} catch (error) {
				this.uploadMessage = this.t('magpie_copy_failed');
			}
		}
	}
};
