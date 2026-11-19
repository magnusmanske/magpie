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
				<button class="btn btn-primary" :disabled="loading" @click="translate">Get text</button>
				<button class="btn btn-success" :disabled="!text || uploading" @click="upload">Upload to Commons</button>
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
				<a class="btn btn-outline-secondary" :href="commonsUploadUrl" target="_blank" rel="noopener">Manual upload</a>
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
				<a class="btn btn-outline-secondary" :href="sourceEditUrl" target="_blank" rel="noopener">Edit original page</a>
				<a class="btn btn-outline-danger" :href="deleteUrl" target="_blank" rel="noopener">Delete original file</a>
			</p>
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
			ignorewarnings: true,
			loading: false,
			uploading: false,
			message: '',
			uploadMessage: '',
			warnings: [],
			text: '',
			isGood: false,
			sourceUrl: '',
			page: ''
		};
	},
	computed: {
		bareImage() {
			return this.image.trim().replace(/^(File|Image):/i, '').trim();
		},
		effectiveName() {
			return this.newname.trim() || this.bareImage;
		},
		sourcePageUrl() {
			return 'https://' + this.language + '.' + this.project + '.org/wiki/File:' +
				encodeURIComponent(this.bareImage.replace(/ /g, '_'));
		},
		sourceEditUrl() {
			return 'https://' + this.language + '.' + this.project + '.org/w/index.php?title=File:' +
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
			return 'https://' + this.language + '.' + this.project + '.org/w/index.php?title=' + title +
				'&action=delete&wpReason=' + reason;
		}
	},
	mounted() {
		Magpie.refreshAuth();
		const params = new URLSearchParams(window.location.search);
		['image', 'language', 'project', 'newname'].forEach((key) => {
			if (params.get(key)) this[key] = params.get(key);
		});
		if (this.image && params.get('image')) this.translate();
	},
	methods: {
		async translate() {
			this.message = '';
			this.uploadMessage = '';
			this.page = '';
			this.warnings = [];
			if (!this.image.trim()) {
				this.message = 'Please name the file on the source wiki.';
				return;
			}
			this.loading = true;
			try {
				const query = new URLSearchParams({
					image: this.image.trim(),
					language: this.language.trim() || 'en',
					project: this.project.trim() || 'wikipedia',
					newname: this.effectiveName,
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
			} catch (error) {
				this.text = '';
				this.message = String(error.message || error);
			} finally {
				this.loading = false;
			}
		},
		async upload() {
			this.uploadMessage = '';
			this.page = '';
			if (!this.text.trim()) return;
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
					blockwarnings: 'duplicate|duplicate-archive'
				});
				if (result.error && result.error !== 'OK') throw new Error(result.error);
				this.page = Magpie.commonsPage(this.effectiveName);
				this.uploadMessage = 'Transfer successful!';
			} catch (error) {
				this.uploadMessage = String(error.message || error);
			} finally {
				this.uploading = false;
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
