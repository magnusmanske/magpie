Magpie.Views = Magpie.Views || {};

Magpie.Views.commonshelper = {
	template: `
	<div>
		<div class="magpie-card">
			<h2>CommonsHelper</h2>
			<p class="magpie-hint">Read a file from another wiki and build the Commons description page.
				The original page's description, license, and upload history are translated where possible.</p>
			<div v-if="auth.checked && !auth.ok" class="magpie-card">
				<strong>You are not logged in.</strong>
				<a :href="authorizeUrl">Log in with OAuth</a> for direct uploads.
			</div>
			<div class="magpie-row">
				<div class="magpie-field">
					<label>Language</label>
					<input v-model="language" class="form-control magpie-mono" size="6">
				</div>
				<div class="magpie-field">
					<label>Project</label>
					<input v-model="project" class="form-control magpie-mono" size="10">
				</div>
				<div class="magpie-field">
					<label>File name on that wiki</label>
					<input v-model="image" class="form-control" placeholder="Example.jpg">
				</div>
				<div class="magpie-field">
					<label>New name on Commons</label>
					<input v-model="newname" class="form-control" :placeholder="image">
				</div>
			</div>
			<div class="magpie-row">
				<label class="magpie-check"><input type="checkbox" v-model="removeCategories"> Remove source categories</label>
				<label class="magpie-check"><input type="checkbox" v-model="ignorewarnings"> Ignore warnings</label>
				<label class="magpie-check"><input type="checkbox" v-model="directUpload"> Direct upload</label>
			</div>
			<div class="magpie-row">
				<button class="btn btn-primary" :disabled="loading" @click="translate">Get text</button>
				<button v-if="directUpload" class="btn btn-success"
					:disabled="!text || !isGood || uploading || loading" @click="upload">Upload to Commons</button>
				<span v-else class="magpie-hint">Use the manual upload button below.</span>
			</div>
			<p v-if="message" class="magpie-status magpie-error">{{ message }}</p>
			<p v-if="warnings.length" class="magpie-status magpie-error">
				<span v-for="warning in warnings" :key="warning">{{ warning }}<br></span>
			</p>
		</div>

		<div class="magpie-card" v-if="text">
			<h3>Description</h3>
			<p class="magpie-hint">
				<span v-if="isGood" class="magpie-ok">A free license was recognised.</span>
				<span v-else class="magpie-error">No free license was recognised. Check the text before uploading.</span>
			</p>
			<textarea v-model="text" rows="20" class="form-control magpie-mono"></textarea>
			<div class="magpie-actions">
				<a class="btn btn-outline-secondary" :href="sourceUrl" target="_blank" rel="noopener">Source file</a>
				<form :action="commonsUploadUrl" method="post" enctype="multipart/form-data"
					target="_blank" rel="noopener" class="d-inline">
					<input type="hidden" name="wpUploadDescription" :value="text">
					<button type="submit" class="btn btn-outline-secondary">Manual upload</button>
				</form>
				<button class="btn btn-outline-secondary" @click="copyText">Copy text</button>
			</div>
			<p v-if="page" class="magpie-ok">Uploaded: <a :href="page" target="_blank">{{ page }}</a></p>
			<p v-if="uploadMessage" class="magpie-status" :class="page ? 'good' : 'bad'">{{ uploadMessage }}</p>
		</div>

		<div class="magpie-card" v-if="page">
			<h3>Now that it is on Commons</h3>
			<p>Add this to the original file page:</p>
			<textarea readonly rows="2" class="form-control magpie-mono">{{ nowCommons }}</textarea>
			<p class="magpie-actions">
				<button class="btn btn-primary" :disabled="nowCommonsBusy || !auth.ok" @click="applyNowCommons">
					Add {{ nowCommonsLabel }}</button>
				<a class="btn btn-outline-secondary" :href="sourceEditUrl" target="_blank" rel="noopener">Edit original page</a>
				<a class="btn btn-outline-danger" :href="deleteUrl" target="_blank" rel="noopener">Delete original file</a>
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
			nowCommonsError: false
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
		nowCommonsLabel() {
			return '{{NowCommons}}';
		},
		deleteUrl() {
			const title = encodeURIComponent('File:' + this.bareImage.replace(/ /g, '_'));
			const reason = encodeURIComponent('NowCommons [[:commons:File:' + this.effectiveName + ']]');
			return 'https://' + this.site + '/w/index.php?title=' + title +
				'&action=delete&wpReason=' + reason;
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
			this.uploadMessage = 'Log in before starting a direct upload.';
		} else if (!this.isGood) {
			this.uploadMessage = 'No free license was recognised; not uploading.';
		} else if (translated && (!this.nameCollision || this.ignorewarnings)) {
			await this.upload();
		} else if (translated && this.nameCollision) {
			this.uploadMessage = 'The file name was changed because it already exists; review it and upload.';
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
				this.message = 'Please name the file on the source wiki.';
				return false;
			}
			this.loading = true;
			try {
				const query = new URLSearchParams({
					image: this.bareImage,
					language: this.language.trim() || 'en',
					project: this.project.trim() || 'wikipedia',
					newname: this.newname.trim(),
					remove_categories: this.removeCategories ? '1' : '0'
				});
				const response = await fetch('/commonshelper/translate?' + query.toString());
				const data = await response.json();
				if (data.error && data.error !== 'OK') throw new Error(data.error);
				this.text = data.text;
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
		/* The PHP tool renames a colliding file to "<name> (1).<ext>",
		   " (2)" and so on; it never overwrites an existing file. */
		async resolveCommonsName() {
			const wanted = this.effectiveName;
			if (!wanted) return;
			let candidate = wanted;
			for (let count = 1; count <= 50; count++) {
				if (!(await this.commonsExists(candidate))) {
					if (candidate !== wanted) {
						this.newname = candidate;
						this.renamedFrom = wanted;
						this.nameCollision = true;
						this.warnings.unshift('"' + wanted + '" already exists on Commons; the name was changed to "'
							+ candidate + '". Check the name before uploading.');
					}
					return;
				}
				candidate = this.numberedName(wanted, count);
			}
			throw new Error('Could not find a free file name on Commons for "' + wanted + '".');
		},
		numberedName(name, count) {
			const dot = name.lastIndexOf('.');
			if (dot <= 0) return name + ' (' + count + ')';
			return name.slice(0, dot) + ' (' + count + ')' + name.slice(dot);
		},
		async commonsExists(name) {
			const answer = await Magpie.api.flickrExisting([name]);
			if (!answer || answer.status !== 'OK') {
				throw new Error('Could not check the file name on Commons; please try again.');
			}
			const status = ((answer.data || {}).files || {})[Magpie.fileName(name)];
			return status === 1;
		},
		async upload() {
			this.uploadMessage = '';
			this.page = '';
			if (!this.text.trim()) return;
			if (!this.isGood) {
				this.uploadMessage = 'No free license was recognised; not uploading.';
				return;
			}
			if (!this.sourceUrl) {
				this.uploadMessage = 'The source URL is unknown; load the description first.';
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
				this.uploadMessage = 'Transfer successful!';
			} catch (error) {
				this.uploadMessage = String(error.message || error);
			} finally {
				this.uploading = false;
			}
		},
		async applyNowCommons() {
			if (this.nowCommonsBusy) return;
			const title = 'File:' + this.bareImage.replace(/ /g, '_');
			if (!window.confirm('Add ' + this.nowCommons + ' to ' + title + '?')) return;
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
					this.nowCommonsMessage = 'The page already contains the template.';
					return;
				}
				const basetimestamp = (revision && revision.timestamp) || '';
				const answer = await Magpie.api.setPageText(
					title, this.nowCommons + '\n' + text, this.site, 'Now commons', basetimestamp);
				if (answer.error && answer.error !== 'OK') throw new Error(answer.error);
				this.nowCommonsMessage = 'The template was added to the original page.';
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
				this.uploadMessage = 'Text copied.';
			} catch (error) {
				this.uploadMessage = 'Could not copy; select the text and copy it manually.';
			}
		}
	}
};
