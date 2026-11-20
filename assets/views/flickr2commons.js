/* Flickr2Commons: the batch interface of the old tool, on magpie's API. */

Magpie.Views = Magpie.Views || {};

Magpie.Views.flickr2commons = (function () {
	const MAX_CONCURRENT_TRANSFERS = 5;
	const PD_RATIONALE_SUGGESTIONS = [
		'PD-US-expired',
		'PD-US-no-notice',
		'PD-US-not-renewed',
		'PD-old-70',
		'PD-old-100',
		'PD-USGov',
		'PD-USGov-NASA',
		'PD-USGov-Military',
		'PD-UKGov',
		'PD-textlogo',
		'PD-shape',
		'PD-Art'
	];

	function ownerKey(file) {
		return file.owner || file.path_alias || '';
	}

	function blankFileFields() {
		return {
			page: '',
			f2c_status: 'READY',
			existing_filename_on_commons: '',
			new_title: '',
			new_description: '',
			user_categories: '',
			auto_categories: false,
			is_checked: true,
			filename_status: 'checking',
			error_message: ''
		};
	}

	function message(key, fallback, params) {
		return Magpie.commons.msg(key, fallback, params);
	}

	return {
		components: {
			'flickr-file': Magpie.Components.flickrFile
		},
		template: `
		<div class="f2c-main-page" :class="{ 'f2c-main-page--loading': running || checking_commons, 'f2c-has-transfer-bar': has_run && !running }">
			<div v-if="last_error" class="f2c-status-message mt-3" role="alert">
				<div class="f2c-message f2c-message--error">
					<div class="f2c-message__content"><span>{{ last_error }}</span></div>
				</div>
			</div>
			<div v-if="last_message" class="f2c-status-message mt-3" aria-live="polite"
				:aria-busy="(running || checking_commons).toString()">
				<div class="f2c-message f2c-message--progressive">
					<div class="f2c-message__content"><span>{{ displayed_last_message }}</span></div>
				</div>
			</div>
			<div v-if="running || checking_commons" class="analysis-progress f2c-status-message__progress"
				role="progressbar" aria-label="Loading"></div>

			<div v-if="form_is_visible" class="f2c-input-form magpie-card mt-3">
				<p class="f2c-tool-description">Flickr-to-Commons is a web application for batch uploading Flickr files to Wikimedia Commons, the media repository powering Wikipedia.</p>
				<div v-if="keyStatus" class="magpie-error mb-2">{{ keyStatus }}</div>
				<div v-if="auth.checked && !auth.ok" class="f2c-login-action">
					<a :href="authorizeUrl" class="btn btn-primary btn-sm" @click="rememberRouteForLogin">Log in</a>
					<span class="magpie-hint">to upload under your own Commons account.</span>
				</div>
				<form v-if="is_authorized" @submit.prevent="doRun">
					<div class="magpie-field">
						<label for="f2c-input">Flickr URL or ID</label>
						<p class="f2c-field-hint">Enter a Flickr photo, album, group, or user URL or ID.</p>
						<div class="f2c-input-row">
							<input id="f2c-input" type="text" class="form-control" v-model="combined_input"
								@input="pending_route = null">
							<div v-if="input_error" class="f2c-filename-notice f2c-filename-notice--input">
								<div class="f2c-filename-notice__content"><strong>{{ input_error }}</strong></div>
							</div>
						</div>
					</div>
					<div class="magpie-field">
						<label for="f2c-flickr-tag">Flickr tag filter</label>
						<p class="f2c-field-hint">Optionally limit the results to photos with this Flickr tag. Separate multiple tags with a comma.</p>
						<input id="f2c-flickr-tag" type="text" class="form-control" v-model="tag"
							autocomplete="off" @keyup="validateTag">
						<div v-if="tag_warning" class="f2c-filename-notice f2c-filename-notice--input f2c-filename-notice--warning">
							<div class="f2c-filename-notice__content">{{ tag_warning }}</div>
						</div>
					</div>
					<div class="magpie-field">
						<label for="f2c-max-pictures">Maximum number of photos</label>
						<p class="f2c-field-hint">Limits how many photos are loaded from Flickr.<br>
							Leave blank for “unlimited”.</p>
						<input id="f2c-max-pictures" type="number" min="0" class="form-control" v-model="max_pictures">
					</div>
					<div class="mt-3">
						<button type="submit" class="btn btn-primary" :disabled="!apiKey">Start</button>
					</div>
				</form>
			</div>

			<div v-if="!auth.checked" class="f2c-form-auth-loading" aria-live="polite" aria-busy="true">
				<div class="analysis-progress" role="progressbar" aria-label="Checking login"></div>
			</div>

			<div v-if="!running && has_run" class="results-section mt-3">
				<div class="f2c-results-toolbar">
					<button type="button" class="btn btn-sm btn-outline-secondary" @click.prevent="resetSearch">New search</button>
				</div>
				<div v-for="(text, index) in skipped_messages" :key="'skipped-' + index" class="f2c-status-message" role="status">
					<div class="f2c-message f2c-message--warning">
						<div class="f2c-message__content"><span>{{ text }}</span></div>
					</div>
				</div>

				<aside v-if="loaded_context" class="f2c-source-info" aria-label="Loaded Flickr source">
					<div class="f2c-source-info__content">
						<strong class="f2c-source-info__type">{{ loaded_context_type }}</strong>
						<a v-if="loaded_context.href" class="f2c-source-info__title"
							:href="loaded_context.href" target="_blank" rel="noopener">{{ loaded_context.title || loaded_context.label }}</a>
						<strong v-else class="f2c-source-info__title">{{ loaded_context.title || loaded_context.label }}</strong>
						<dl class="f2c-source-info__details">
							<div v-if="loaded_context.author" class="f2c-source-info__row">
								<dt>Author</dt><dd>{{ loaded_context.author }}</dd>
							</div>
							<div v-if="loaded_license_summary" class="f2c-source-info__row">
								<dt>License</dt><dd>{{ loaded_license_summary }}</dd>
							</div>
							<div v-if="loaded_context.description" class="f2c-source-info__row f2c-source-info__row--description">
								<dt>Description</dt><dd>{{ loaded_context.description }}</dd>
							</div>
						</dl>
						<small>{{ files.length }} freely licensed {{ files.length === 1 ? 'file' : 'files' }} loaded</small>
					</div>
				</aside>

				<div v-if="pd_warning_message" class="f2c-status-message f2c-pd-rationale" role="status">
					<div class="f2c-message f2c-message--warning">
						<div class="f2c-message__content">
							<span>{{ pd_warning_message }}</span>
							<p class="f2c-field-hint">Enter the Commons licence template that says why these files are in the public domain. It is added to those files only, alongside the Flickr tag.</p>
							<input type="text" class="form-control f2c-pd-rationale__input" v-model="pd_rationale"
								list="f2c-pd-rationale-list" placeholder="PD-US-expired"
								aria-label="Public domain licence template">
							<datalist id="f2c-pd-rationale-list">
								<option v-for="template in pd_rationale_suggestions" :key="template" :value="template"></option>
							</datalist>
							<p v-if="pd_rationale_template" class="f2c-pd-rationale__preview">Will be added to {{ generic_pd_files.length }} files: <code>{{ pd_rationale_preview }}</code></p>
						</div>
					</div>
				</div>

				<div class="options-panel magpie-card">
					<h2 class="f2c-options-heading">Options</h2>
					<label class="magpie-check" for="use_flickr_descriptions">
						<input id="use_flickr_descriptions" type="checkbox" v-model="use_flickr_descriptions">
						<span>Use descriptions from Flickr</span>
					</label>
					<p class="f2c-field-hint">Used when a file does not have a manually entered description.</p>

					<div class="magpie-field">
						<label for="f2c-add-description">Append to every description</label>
						<textarea id="f2c-add-description" rows="2" class="form-control" v-model="add2every_desc"></textarea>
					</div>
					<div class="magpie-field">
						<label for="f2c-append-everywhere">Append to every page</label>
						<p class="f2c-field-hint">Wikitext added at the end of every file page, for example categories or templates.</p>
						<textarea id="f2c-append-everywhere" rows="2" class="form-control" v-model="append_everywhere"></textarea>
					</div>

					<fieldset class="f2c-tag-fieldset">
						<legend class="f2c-fieldset-legend">Bulk-action scope</legend>
						<p class="f2c-field-hint">Choose which loaded files selection and title actions should affect.</p>
						<div class="f2c-scope-options">
							<label class="f2c-tag-radio">
								<input type="radio" name="which_files" v-model="which_files" value="all">
								<span class="f2c-scope-label"><strong>All available files</strong><small>Every file that can still be uploaded.</small></span>
							</label>
							<label class="f2c-tag-radio">
								<input type="radio" name="which_files" v-model="which_files" value="issues">
								<span class="f2c-scope-label"><strong>Filename issues</strong><small>Titles that exist, were deleted, or are too generic.</small></span>
							</label>
							<label v-if="Object.keys(tags).length > 0" class="f2c-tag-radio">
								<input type="radio" name="which_files" v-model="which_files" value="with">
								<span class="f2c-scope-label"><strong>Files with tag</strong><small>Only files containing the chosen Flickr tag.</small></span>
							</label>
							<label v-if="Object.keys(tags).length > 0" class="f2c-tag-radio">
								<input type="radio" name="which_files" v-model="which_files" value="without">
								<span class="f2c-scope-label"><strong>Files without tag</strong><small>Files that do not contain the chosen Flickr tag.</small></span>
							</label>
						</div>
						<label v-if="Object.keys(tags).length > 0 && (which_files === 'with' || which_files === 'without')"
							class="f2c-tag-picker mt-2" for="f2c-selected-tag">
							<span>Tag</span>
							<select id="f2c-selected-tag" class="form-control" v-model="selected_tag">
								<option v-for="(list, tagName) in tags" :key="tagName" :value="tagName">{{ tagName }} ({{ list.length }})</option>
							</select>
						</label>
						<div class="f2c-scope-actions">
							<span class="f2c-scope-count">{{ getFilesInTagSelection().length }} matching {{ getFilesInTagSelection().length === 1 ? 'file' : 'files' }}</span>
							<div>
								<button type="button" class="btn btn-sm btn-primary" @click.prevent="doSelectAll">Select matching files</button>
								<button type="button" class="btn btn-sm btn-outline-secondary" @click.prevent="doDeselectAll">Deselect matching files</button>
							</div>
						</div>
					</fieldset>

					<div class="f2c-title-action">
						<span class="f2c-section-label">Append text to title</span>
						<div class="f2c-title-affix-fields">
							<label class="f2c-find-replace-field">
								<span>Prefix</span>
								<span class="f2c-affix-control">
									<input type="text" class="form-control" v-model="prefix_string">
									<button type="button" class="btn btn-sm btn-outline-secondary" @click.prevent="doPrefix">Prefix</button>
								</span>
							</label>
							<label class="f2c-find-replace-field">
								<span>Suffix</span>
								<span class="f2c-affix-control">
									<input type="text" class="form-control" v-model="suffix_string">
									<button type="button" class="btn btn-sm btn-outline-secondary" @click.prevent="doSuffix">Suffix</button>
								</span>
							</label>
						</div>
					</div>

					<div class="f2c-title-action">
						<span class="f2c-section-label">Find / replace in title</span>
						<div class="f2c-find-replace-fields">
							<label class="f2c-find-replace-field" for="f2c-title-find">
								<span>Find</span>
								<input id="f2c-title-find" type="text" class="form-control" v-model="title_regex_pattern">
							</label>
							<label class="f2c-find-replace-field" for="f2c-title-replace">
								<span>Replace with</span>
								<input id="f2c-title-replace" type="text" class="form-control" v-model="title_regex_replace">
							</label>
						</div>
						<div class="f2c-find-replace-actions">
							<label class="magpie-check" for="f2c-title-regex">
								<input id="f2c-title-regex" type="checkbox" v-model="title_use_regex">
								<span>Use regular expression</span>
							</label>
							<button type="button" class="btn btn-sm btn-primary" @click.prevent="doTitleReplace">Replace</button>
						</div>
					</div>

					<div class="f2c-populate-categories">
						<div>
							<strong>Populate suggested categories</strong>
							<p class="f2c-field-hint mb-0">Fetch suggestions for the matching files and place them in the editable category fields for review.</p>
						</div>
						<button type="button" class="btn btn-sm btn-primary" :disabled="populating_categories"
							@click.prevent="populateCategories">{{ populating_categories ? 'Loading…' : 'Populate categories' }}</button>
					</div>
					<p v-if="category_population_message" class="f2c-category-result" aria-live="polite">{{ category_population_message }}</p>
				</div>

				<div class="flickr-file-list mt-2">
					<flickr-file v-for="file in files" :key="file.id" :file="file"
						:hide_files_on_commons="hide_files_on_commons"
						:use_flickr_descriptions="use_flickr_descriptions"
						@retry="onRetry"></flickr-file>
				</div>

				<div class="transfer-bar">
					<div class="transfer-bar__status">
						<template v-if="!upload_has_started">
							<span>{{ selection_summary }}</span>
							<span v-if="filename_previously_deleted_on_commons > 0" class="magpie-error ms-2">{{ deleted_summary }}</span>
							<label v-if="on_commons > 0" class="magpie-check transfer-bar__hide-existing">
								<input type="checkbox" v-model="hide_files_on_commons">
								<span>{{ hide_on_commons_label }}</span>
							</label>
						</template>
						<div v-if="upload_has_started" class="transfer-bar__progress-wrap">
							<div class="transfer-bar__progress" role="progressbar"
								:aria-valuenow="transfer_progress_percent" aria-valuemin="0" aria-valuemax="100">
								<div class="transfer-bar__progress-segment transfer-bar__progress-segment--success"
									:style="{ width: transfer_success_percent + '%' }"></div>
								<div v-if="transfers_failed > 0" class="transfer-bar__progress-segment transfer-bar__progress-segment--failed"
									:style="{ width: transfer_failed_percent + '%' }"></div>
								<div v-if="transfers_running > 0" class="transfer-bar__progress-segment transfer-bar__progress-segment--running"
									:style="{ width: transfer_running_percent + '%' }"></div>
							</div>
							<div v-if="transfers_running > 0" class="analysis-progress transfer-bar__activity"
								role="progressbar" aria-label="Uploads in progress"></div>
							<small class="transfer-bar__progress-label">
								{{ transfers_completed }} / {{ transfer_progress_total }}<span v-if="transfers_failed > 0"> ({{ transfers_failed }} failed)</span>
							</small>
						</div>
					</div>
					<div class="transfer-bar__actions">
						<button v-if="currently_selected > 0 && transfers_running === 0" type="button"
							class="btn btn-primary btn-sm" @click="transferAll">Upload selected files</button>
						<button v-if="transfers_running > 0" type="button" class="btn btn-danger btn-sm"
							:disabled="stop_transfers" @click="stopTransfers">Stop uploads</button>
					</div>
				</div>
			</div>
		</div>`,
		data() {
			return {
				auth: Magpie.authState,
				authorizeUrl: Magpie.api.authorizeUrl(),
				apiKey: '',
				keyStatus: '',
				last_error: '',
				last_message: '',
				checking_commons: false,
				running: false,
				has_run: false,

				combined_input: '',
				tag: '',
				max_pictures: '',
				input_error: '',
				tag_warning: '',
				pending_route: null,

				files: [],
				tags: {},
				owners: {},
				loaded_context: null,

				which_files: 'all',
				selected_tag: '',
				prefix_string: '',
				suffix_string: '',
				title_regex_pattern: '',
				title_regex_replace: '',
				title_use_regex: false,
				add2every_desc: '',
				append_everywhere: '',
				use_flickr_descriptions: true,
				hide_files_on_commons: true,
				populating_categories: false,
				category_population_message: '',

				transfers_running: 0,
				stop_transfers: false,
				form_is_visible: true,
				pd_rationale: '',
				non_free_filtered: 0,
				no_url_filtered: 0,
				load_generation: 0
			};
		},
		computed: {
			is_authorized() {
				return this.auth.checked && this.auth.ok;
			},
			displayed_last_message() {
				return String(this.last_message || '').replace(/Wikimedia Commons/g, 'Wikimedia\u00a0Commons');
			},
			currently_selected() {
				return this.files.filter((file) =>
					file.is_checked
					&& file.existing_filename_on_commons === ''
					&& file.filename_status !== 'exists'
					&& file.filename_status !== 'simple'
					&& file.filename_status !== 'blacklisted'
					&& file.f2c_status === 'READY').length;
			},
			filename_exists_on_commons() {
				return this.files.filter((file) =>
					['exists', 'simple', 'blacklisted'].includes(file.filename_status)).length;
			},
			filename_previously_deleted_on_commons() {
				return this.files.filter((file) => file.filename_status === 'deleted').length;
			},
			on_commons() {
				return this.files.filter((file) => file.existing_filename_on_commons !== '').length;
			},
			selection_summary() {
				return this.currently_selected + ' files are currently selected and ready to transfer; '
					+ this.filename_exists_on_commons + ' have a filename issue.';
			},
			deleted_summary() {
				const count = this.filename_previously_deleted_on_commons;
				return count + (count === 1 ? ' filename was' : ' filenames were')
					+ ' previously deleted from Wikimedia Commons.';
			},
			hide_on_commons_label() {
				return 'Hide ' + this.on_commons + ' files already on Wikimedia Commons';
			},
			pd_rationale_suggestions() {
				return PD_RATIONALE_SUGGESTIONS;
			},
			generic_pd_files() {
				return this.files.filter((file) =>
					Magpie.flickr.GENERIC_PD_LICENSE_IDS.has(String(file.license)));
			},
			pd_rationale_template() {
				return this.pd_rationale
					.replace(/[{}\[\]\r\n]/g, '')
					.replace(/^\s*Template:/i, '')
					.trim();
			},
			pd_rationale_preview() {
				return this.pd_rationale_template ? '{{' + this.pd_rationale_template + '}}' : '';
			},
			pd_warning_message() {
				const count = this.generic_pd_files.length;
				if (count < 1) return '';
				return count + " files use Flickr's generic public-domain marker, which Wikimedia Commons does not accept on its own. Without a specific reason the files are tagged as lacking a licence and may be deleted.";
			},
			skipped_messages() {
				return Magpie.commons.skippedFileMessages({
					nonFree: this.non_free_filtered,
					noUrl: this.no_url_filtered,
					loaded: this.files.length
				});
			},
			transfers_completed() {
				return this.files.filter((file) => file.f2c_status === 'DONE').length;
			},
			transfers_failed() {
				return this.files.filter((file) => file.f2c_status === 'ERROR').length;
			},
			upload_has_started() {
				return this.transfers_running > 0 || this.transfers_completed + this.transfers_failed > 0;
			},
			transfer_progress_total() {
				return this.transfers_completed + this.transfers_failed
					+ this.transfers_running + this.currently_selected;
			},
			transfer_progress_percent() {
				if (this.transfer_progress_total === 0) return 0;
				return Math.round(100 * (this.transfers_completed + this.transfers_failed) / this.transfer_progress_total);
			},
			transfer_success_percent() {
				return this.transfer_progress_total === 0 ? 0 : 100 * this.transfers_completed / this.transfer_progress_total;
			},
			transfer_failed_percent() {
				return this.transfer_progress_total === 0 ? 0 : 100 * this.transfers_failed / this.transfer_progress_total;
			},
			transfer_running_percent() {
				return this.transfer_progress_total === 0 ? 0 : 100 * this.transfers_running / this.transfer_progress_total;
			},
			loaded_context_type() {
				if (!this.loaded_context) return '';
				return {
					user: 'Flickr account',
					photoset: 'Flickr album',
					group: 'Flickr group',
					photo: 'Flickr photo'
				}[this.loaded_context.type] || 'Flickr source';
			},
			loaded_license_summary() {
				const names = this.files
					.map((file) => (Magpie.flickr.LICENSES[String(file.license)] || {}).name)
					.filter(Boolean);
				return Array.from(new Set(names)).join(', ');
			}
		},
		async mounted() {
			await Promise.all([Magpie.refreshAuth(), this.loadKey()]);
			this.applyQuery();
		},
		methods: {
			async loadKey() {
				try {
					const result = await Magpie.api.flickrKey();
					if (result.status === 'OK' && result.data) this.apiKey = result.data;
					else this.keyStatus = result.status || 'The Flickr API key is not configured.';
				} catch (error) {
					this.keyStatus = String(error.message || error);
				}
			},
			/* Legacy deep links: ?photoid=…, ?userid=…, ?photoset=…, ?tags=…, ?maxpics=…
			   The newer interface uses hash routes: #/user/…, #/photo/… with
			   ?tag=… and ?max_pictures=… . */
			applyQuery() {
				const { query, route } = this.readRoute();
				if (query.has('max_pictures')) this.max_pictures = query.get('max_pictures');
				if (query.has('maxpics')) this.max_pictures = query.get('maxpics');
				if (query.has('tags')) this.tag = (query.get('tags') || '').replace(/_/g, ' ');
				if (query.has('tag')) this.tag = query.get('tag');
				if (route) {
					this.combined_input = route.value;
					this.pending_route = route;
				} else {
					const routes = [
						['photoid', 'photo'],
						['photoset', 'photoset'],
						['group', 'group'],
						['userid', 'user']
					];
					for (const [name, type] of routes) {
						if (!query.has(name)) continue;
						const value = (query.get(name) || '').replace(/_/g, ' ').trim();
						if (!value) break;
						this.combined_input = value;
						this.pending_route = { type: type, value: value };
						break;
					}
				}
				if (!this.combined_input) return;
				if (this.is_authorized) this.doRun();
				else this.input_error = 'Log in to start this transfer.';
			},
			readRoute() {
				const hash = window.location.hash || '';
				if (hash.startsWith('#/')) {
					const raw = hash.slice(2);
					const split = raw.indexOf('?');
					const path = split >= 0 ? raw.slice(0, split) : raw;
					const query = new URLSearchParams(split >= 0 ? raw.slice(split + 1) : '');
					const [type, ...rest] = path.split('/');
					let value = rest.join('/');
					try { value = decodeURIComponent(value); } catch (error) { /* keep the raw value */ }
					const map = { user: 'user', photoset: 'photoset', group: 'group', photo: 'photo', url: 'user' };
					if (map[type] && value) return { query: query, route: { type: map[type], value: value } };
					return { query: query, route: null };
				}
				return { query: new URLSearchParams(window.location.search), route: null };
			},
			syncRoute(type, value) {
				const route = '#/' + type + '/' + encodeURIComponent(value) + this.getRouteParams();
				if (window.location.hash !== route) {
					window.history.replaceState(null, '', window.location.pathname + window.location.search + route);
				}
			},
			logError(text) {
				this.running = false;
				this.last_message = '';
				this.last_error = text;
			},
			rememberRouteForLogin() {
				try {
					window.sessionStorage.setItem('magpie_return_to',
						window.location.pathname + window.location.search + window.location.hash);
				} catch (error) {
					/* storage unavailable */
				}
			},
			resetSearch() {
				if (this.transfers_running > 0
					&& !window.confirm('Return to the start form? The current load and results will be cleared.')) return;
				this.load_generation++;
				this.stop_transfers = true;
				this.running = false;
				this.checking_commons = false;
				this.has_run = false;
				this.form_is_visible = true;
				this.files = [];
				this.tags = {};
				this.owners = {};
				this.loaded_context = null;
				this.last_error = '';
				this.last_message = '';
				this.input_error = '';
				this.pd_rationale = '';
				this.populating_categories = false;
				this.category_population_message = '';
				if (window.location.hash) {
					window.history.replaceState(null, '', window.location.pathname + window.location.search);
				}
			},
			validateTag() {
				this.tag_warning = '';
				const value = (this.tag || '').trim();
				if (value && !value.includes(',') && value.split(/\s+/).length >= 3) {
					this.tag_warning = 'If these are multiple tags, separate them with commas.';
				}
			},
			async hydrateLoadedContext(type, id) {
				const info = await Magpie.flickr.sourceInfo(this.apiKey, type, id);
				if (!info || !this.loaded_context
					|| this.loaded_context.type !== type || this.loaded_context.id !== id) return;
				const plain = Magpie.flickr.plain;
				let title = '';
				let author = '';
				let href = this.loaded_context.href || '';
				let description = plain(info.description);
				if (type === 'user') {
					title = plain(info.username) || plain(info.realname) || this.loaded_context.label;
					author = plain(info.realname);
					description = plain(info.description) || plain(info.profile_description);
					const user = plain(info.path_alias) || plain(info.nsid) || id;
					if (user) href = 'https://www.flickr.com/photos/' + encodeURIComponent(user) + '/';
				} else if (type === 'photoset') {
					title = plain(info.title) || this.loaded_context.label;
					const ownerId = plain(info.owner && info.owner.nsid) || plain(info.owner);
					const ownerPath = plain(info.owner && info.owner.path_alias) || ownerId;
					let ownerProfile;
					try {
						ownerProfile = ownerId ? await Magpie.flickr.userInfo(this.apiKey, ownerId) : undefined;
					} catch (error) {
						/* best effort */
					}
					if (!this.loaded_context || this.loaded_context.type !== type || this.loaded_context.id !== id) return;
					author = plain(ownerProfile && ownerProfile.realname)
						|| plain(info.ownername) || plain(info.username) || ownerId;
					if (ownerPath) href = 'https://www.flickr.com/photos/' + encodeURIComponent(ownerPath)
						+ '/albums/' + encodeURIComponent(id) + '/';
				} else if (type === 'group') {
					title = plain(info.name) || this.loaded_context.label;
					const group = plain(info.path_alias) || plain(info.nsid) || id;
					if (group) href = 'https://www.flickr.com/groups/' + encodeURIComponent(group) + '/';
				} else if (type === 'photo') {
					title = plain(info.title) || this.loaded_context.label;
					const owner = plain(info.owner && info.owner.nsid) || id;
					author = plain(info.owner && info.owner.realname)
						|| plain(info.owner && info.owner.username) || owner;
					const ownerPath = plain(info.owner && info.owner.path_alias) || owner;
					if (ownerPath) href = 'https://www.flickr.com/photos/' + encodeURIComponent(ownerPath)
						+ '/' + encodeURIComponent(id) + '/';
				}
				this.loaded_context = Object.assign({}, this.loaded_context, {
					title: title,
					author: author,
					description: description,
					href: href
				});
			},
			eligibleFiles() {
				return this.files.filter((file) =>
					file.existing_filename_on_commons === '' && file.f2c_status === 'READY');
			},
			getFilesInTagSelection() {
				const ids = this.tags[this.selected_tag] || [];
				const inTag = new Set(ids);
				const ISSUE_STATUSES = new Set(['exists', 'simple', 'blacklisted', 'deleted']);
				if (this.which_files === 'all') return this.eligibleFiles();
				if (this.which_files === 'issues') {
					return this.eligibleFiles().filter((file) => ISSUE_STATUSES.has(file.filename_status));
				}
				if (this.which_files === 'with') {
					return this.files.filter((file, index) =>
						inTag.has(index) && file.existing_filename_on_commons === '' && file.f2c_status === 'READY');
				}
				if (this.which_files === 'without') {
					return this.files.filter((file, index) =>
						!inTag.has(index) && file.existing_filename_on_commons === '' && file.f2c_status === 'READY');
				}
				return [];
			},
			doSelectAll() {
				this.getFilesInTagSelection().forEach((file) => { file.is_checked = true; });
			},
			doDeselectAll() {
				this.getFilesInTagSelection().forEach((file) => { file.is_checked = false; });
			},
			async populateCategories() {
				const files = this.getFilesInTagSelection();
				if (files.length === 0 || this.populating_categories) return;
				const generation = this.load_generation;
				this.populating_categories = true;
				this.category_population_message = 'Loading suggestions for ' + files.length + ' '
					+ (files.length === 1 ? 'file' : 'files') + '…';
				let updated = 0;
				let unchanged = 0;
				let failed = 0;
				for (let offset = 0; offset < files.length; offset += 4) {
					await Promise.all(files.slice(offset, offset + 4).map(async (file) => {
						let suggestions = [];
						try {
							suggestions = await Magpie.flickr.suggestedCategories(file.id);
						} catch (error) {
							failed++;
						}
						if (generation !== this.load_generation) return;
						const description = Magpie.flickr.text(file.description && file.description._content)
							+ '\n' + (file.new_description || '');
						const candidates = suggestions.concat(Magpie.commons.extractSpeakerCategories(description));
						const categories = String(file.user_categories || '').split('\n')
							.map((value) => value.trim()).filter(Boolean);
						const seen = new Set(categories.map((value) => value.toLocaleLowerCase()));
						let added = 0;
						for (const category of candidates) {
							const key = category.toLocaleLowerCase();
							if (seen.has(key)) continue;
							categories.push(category);
							seen.add(key);
							added++;
						}
						file.user_categories = categories.join('\n');
						file.auto_categories = false;
						if (added > 0) updated++;
						else unchanged++;
					}));
					if (generation !== this.load_generation) return;
				}
				this.populating_categories = false;
				const parts = [];
				if (updated) parts.push(updated + ' ' + (updated === 1 ? 'file' : 'files') + ' populated');
				if (unchanged) parts.push(unchanged + ' had no new suggestions');
				if (failed) parts.push(failed + ' failed');
				this.category_population_message = parts.join('; ') + '. Review the category fields below before uploading.';
			},
			doPrefix() {
				const prefix = this.prefix_string.trim();
				if (!prefix) return;
				this.getFilesInTagSelection().forEach((file) => {
					file.new_title = (prefix + ' ' + file.new_title.trim()).trim();
				});
			},
			doSuffix() {
				const suffix = this.suffix_string.trim();
				if (!suffix) return;
				this.getFilesInTagSelection().forEach((file) => {
					file.new_title = Magpie.commons.transformFilenameStem(file.new_title,
						(stem) => stem.trim() + ' ' + suffix);
				});
			},
			doTitleReplace() {
				const find = this.title_regex_pattern;
				const substitute = this.title_regex_replace;
				if (!find) return;
				let regex;
				if (this.title_use_regex) {
					try {
						regex = new RegExp(find, 'g');
					} catch (error) {
						return;
					}
				}
				this.getFilesInTagSelection().forEach((file) => {
					file.new_title = Magpie.commons.transformFilenameStem(file.new_title, (stem) => {
						return this.title_use_regex
							? stem.replace(regex, substitute)
							: stem.split(find).join(substitute);
					});
				});
			},
			completeFileProperties(file) {
				Object.assign(file, blankFileFields());
				const owner = [file.path_alias, file.owner].find((value) => value && value !== 'undefined') || '';
				file.page = owner
					? 'https://www.flickr.com/photos/' + encodeURIComponent(owner) + '/'
						+ encodeURIComponent(file.id) + '/'
					: 'https://www.flickr.com/photo.gne?id=' + encodeURIComponent(file.id);
				file.new_title = Magpie.flickr.generateFilename(file, 'Unnamed Flickr file');
				return file;
			},
			addFileToList(file) {
				if (!Magpie.flickr.isFree(file.license)) {
					this.non_free_filtered++;
					return;
				}
				this.files.push(file);
			},
			rewritePhotoProperties(photo) {
				const tags = ((photo.tags && photo.tags.tag) || []).map((tag) => tag._content);
				const sizes = (photo.sizes && photo.sizes.size) || [];
				const last = sizes.length ? sizes[sizes.length - 1].source : '';
				const small = sizes.find((size) => size.label === 'Small');
				const owner = typeof photo.owner === 'object' ? photo.owner : undefined;
				return {
					id: photo.id,
					title: photo.title && photo.title._content,
					license: photo.license,
					description: photo.description,
					tags: tags.join(' '),
					url_o: last,
					url_best: last,
					url_q: sizes[1] ? sizes[1].source : last,
					url_s: (small && small.source) || (sizes[1] && sizes[1].source) || last,
					originalformat: photo.originalformat,
					owner: (owner && owner.nsid) || photo.owner,
					path_alias: (owner && owner.path_alias) || '',
					ownername: (owner && owner.username) || '',
					owner_realname: (owner && owner.realname) || '',
					datetaken: (photo.dates && photo.dates.taken) || ''
				};
			},
			async checkProposedCommonsFilenames() {
				try {
					const filenames = this.files.map((file) => file.new_title);
					const data = await Magpie.api.flickrExisting(filenames);
					if (data.status !== 'OK') throw new Error(data.status);
					const files = (data.data && data.data.files) || {};
					for (const file of this.files) {
						const key = Magpie.commons.fileKey(file.new_title);
						const status = files[key];
						if (status === undefined) continue;
						Magpie.commons.cache[Magpie.commons.normalizeTitle(file.new_title)] = status;
						file.filename_status = Magpie.commons.statusFromCache(file.new_title);
					}
				} catch (error) {
					/* Fail open: rows must not stay in "checking" forever. */
					for (const file of this.files) {
						const key = Magpie.commons.normalizeTitle(file.new_title);
						if (Magpie.commons.cache[key] === undefined) {
							Magpie.commons.cache[key] = 0;
							file.filename_status = Magpie.commons.statusFromCache(file.new_title);
						}
					}
				}
				for (const file of this.files) {
					const key = Magpie.commons.normalizeTitle(file.new_title);
					if (Magpie.commons.cache[key] !== undefined && Magpie.commons.cache[key] !== 0) continue;
					const titleForBlacklist = key.replace(/\s*\(\d+\)(?=\.[^.]+$)/, '');
					const blocked = await Magpie.commons.checkTitleBlacklist(titleForBlacklist);
					if (!blocked) continue;
					Magpie.commons.cache[key] = 3;
					file.filename_status = 'blacklisted';
				}
			},
			async checkFlickrFilesOnCommons() {
				const generation = this.load_generation;
				this.checking_commons = true;
				this.last_message = 'Checking which files are already on Wikimedia Commons';
				try {
					const data = { files: {}, owners: this.owners };
					for (const nsid of Object.keys(this.owners)) data.files[nsid] = [];
					for (const file of this.files) {
						const key = ownerKey(file);
						if (!key) continue;
						if (!data.files[key]) data.files[key] = [];
						data.files[key].push(file.id);
					}
					const answer = await Magpie.api.flickrInCommons(data);
					if (answer.status !== 'OK') throw new Error(answer.status);
					const found = (answer.data && answer.data.files) || {};
					for (const file of this.files) {
						if (found[file.id] !== undefined) file.existing_filename_on_commons = found[file.id];
					}
				} catch (error) {
					/* No replicas: search Commons directly. */
					const needCheck = this.files.filter((file) =>
						!['exists', 'simple', 'blacklisted'].includes(file.filename_status));
					const CONCURRENCY = 4;
					const timeoutMs = 5000;
					for (let offset = 0; offset < needCheck.length; offset += CONCURRENCY) {
						const batch = needCheck.slice(offset, offset + CONCURRENCY).map(async (file) => {
							try {
								const owners = Array.from(new Set([file.owner, file.path_alias].filter(Boolean)));
								const terms = owners.flatMap((owner) => [
									'"flickr.com/photos/' + owner + '/' + file.id + '"',
									'"flickr.com/photo/' + owner + '/' + file.id + '"'
								]);
								if (!terms.length) terms.push('"flickr.com" "' + file.id + '"');
								const url = new URL('https://commons.wikimedia.org/w/api.php');
								url.searchParams.set('action', 'query');
								url.searchParams.set('list', 'search');
								url.searchParams.set('srnamespace', '6');
								url.searchParams.set('srsearch', terms.join(' OR '));
								url.searchParams.set('srlimit', '1');
								url.searchParams.set('format', 'json');
								url.searchParams.set('formatversion', '2');
								url.searchParams.set('errorformat', 'plaintext');
								url.searchParams.set('maxlag', '5');
								url.searchParams.set('origin', '*');
								const controller = new AbortController();
								const timer = setTimeout(() => controller.abort(), timeoutMs);
								try {
									const response = await fetch(url, {
										headers: { 'Api-User-Agent': 'magpie/1.0 (https://magpie.toolforge.org/)' },
										signal: controller.signal
									});
									clearTimeout(timer);
									if (!response.ok) return;
									const result = await response.json();
									if (result.error) return;
									if (result.query && result.query.search && result.query.search.length > 0) {
										file.existing_filename_on_commons = result.query.search[0].title.replace(/^File:/, '');
									}
								} catch (error) {
									clearTimeout(timer);
								}
							} catch (error) {
								/* skip */
							}
						});
						await Promise.all(batch);
					}
				} finally {
					if (generation !== this.load_generation) return;
					this.checking_commons = false;
					this.last_message = '';
					this.which_files = 'all';
					this.running = false;
					this.has_run = true;
				}
			},
			async hydrateRawTagLabels(generation) {
				const rawByNormalized = new Map();
				const unresolved = new Set();
				for (const file of this.files) {
					for (const tag of String(file.tags || '').split(/\s+/).filter(Boolean)) {
						if (Array.from(tag).length >= 7) unresolved.add(tag.toLocaleLowerCase());
					}
				}
				for (const file of this.files) {
					if (generation !== this.load_generation) return;
					if (unresolved.size === 0) break;
					const fileTags = String(file.tags || '').split(/\s+/).filter(Boolean);
					if (!fileTags.some((tag) => unresolved.has(tag.toLocaleLowerCase()))) continue;
					try {
						const detailedTags = await Magpie.flickr.photoTags(this.apiKey, file.id);
						for (const tag of detailedTags) {
							const normalized = String(tag._content || tag.raw || '').trim().toLocaleLowerCase();
							if (!normalized) continue;
							rawByNormalized.set(normalized, String(tag.raw || tag._content).trim());
							unresolved.delete(normalized);
						}
						for (const tag of fileTags) {
							if (Array.from(tag).length >= 7) unresolved.delete(tag.toLocaleLowerCase());
						}
					} catch (error) {
						/* Keep the machine label; another file may resolve it. */
					}
				}
				if (generation !== this.load_generation) return;
				for (const file of this.files) {
					const displayTags = String(file.tags || '').split(/\s+/).filter(Boolean)
						.map((tag) => rawByNormalized.get(tag.toLocaleLowerCase()) || tag);
					this.$set(file, 'display_tags', displayTags);
				}
			},
			async finishFileLoad() {
				this.selected_tag = '';
				const tags = {};
				this.files.forEach((file, index) => {
					if (!file.tags) return;
					for (let tag of String(file.tags).split(/\s+/)) {
						tag = tag.trim().toLowerCase();
						if (!tag) continue;
						if (!tags[tag]) tags[tag] = [];
						tags[tag].push(index);
					}
				});
				for (const tag of Object.keys(tags)) {
					if (tags[tag].length >= this.files.length) delete tags[tag];
				}
				const firstTag = Object.keys(tags)[0];
				if (firstTag) this.selected_tag = firstTag;
				this.tags = tags;
				this.hydrateRawTagLabels(this.load_generation);

				this.owners = {};
				for (const file of this.files) {
					const key = ownerKey(file);
					if (key) this.owners[key] = key;
				}

				const jobs = [this.checkProposedCommonsFilenames()];
				for (const nsid of Object.keys(this.owners)) {
					jobs.push((async () => {
						const person = await Magpie.flickr.userInfo(this.apiKey, nsid);
						if (!person) return;
						const entry = [nsid];
						const username = person.username && person.username._content !== undefined
							? person.username._content : person.username;
						for (const name of [person.nsid, username, person.path_alias]) {
							if (typeof name === 'string' && name && !entry.includes(name)) entry.push(name);
						}
						this.owners[nsid] = entry;
						const realname = typeof person.realname === 'object'
							? person.realname._content : person.realname;
						if (realname) {
							for (const file of this.files.filter((candidate) => candidate.owner === nsid)) {
								this.$set(file, 'owner_realname', realname);
							}
						}
					})());
				}
				await Promise.all(jobs);
				this.checkFlickrFilesOnCommons();
			},
			async getFlickrFiles(params) {
				const generation = this.load_generation;
				try {
					const photos = await Magpie.flickr.search(
						this.apiKey,
						params,
						Number(this.max_pictures) || 0,
						this.tag,
						(progress) => {
							const percent = progress.pages
								? Math.round(progress.page * 100 / progress.pages) : 0;
							this.last_message = progress.so_far + ' files found so far (' + percent + '% done)';
						});
					if (generation !== this.load_generation) return;
					this.files = [];
					this.non_free_filtered += photos.skipped_non_free || 0;
					this.no_url_filtered += photos.skipped_no_url || 0;
					for (const photo of photos) this.addFileToList(this.completeFileProperties(photo));
					this.finishFileLoad();
				} catch (error) {
					this.running = false;
					this.last_message = '';
					this.form_is_visible = true;
					this.input_error = error.message || String(error);
				}
			},
			async doRunPhotos(photoIds) {
				const generation = this.load_generation;
				this.loaded_context = {
					type: 'photo',
					id: photoIds[0],
					label: photoIds.join(', '),
					href: ''
				};
				if (photoIds.length === 1) this.hydrateLoadedContext('photo', photoIds[0]);
				this.syncRoute('photo', photoIds.join(','));
				let failed = 0;
				await Promise.all(photoIds.map(async (photoId) => {
					try {
						const [info, sizes] = await Promise.all([
							Magpie.flickr.info(this.apiKey, photoId),
							Magpie.flickr.sizes(this.apiKey, photoId)
						]);
						if (generation !== this.load_generation) return;
						if (!info || !sizes) {
							failed++;
							return;
						}
						info.sizes = sizes;
						this.addFileToList(this.completeFileProperties(this.rewritePhotoProperties(info)));
					} catch (error) {
						failed++;
					}
				}));
				if (generation !== this.load_generation) return;
				if (this.files.length === 0 && failed > 0) {
					this.running = false;
					this.last_message = '';
					this.form_is_visible = true;
					this.input_error = 'Could not load the Flickr photo. Check the ID and that the Flickr API key is configured.';
					return;
				}
				this.finishFileLoad();
			},
			async doRunUser(user) {
				const generation = this.load_generation;
				const userId = await Magpie.flickr.lookupUserByAlias(this.apiKey, user)
					|| await Magpie.flickr.resolveUsername(this.apiKey, user);
				if (generation !== this.load_generation) return;
				if (userId === user) {
					const info = await Magpie.flickr.userInfo(this.apiKey, userId);
					if (!info) {
						this.running = false;
						this.last_message = '';
						this.input_error = message('f2c_no_such_user', 'No such user: $1', [user]);
						this.form_is_visible = true;
						return;
					}
				}
				this.loaded_context = { type: 'user', id: userId, label: user, href: '' };
				await this.hydrateLoadedContext('user', userId);
				if (generation !== this.load_generation) return;
				if (!this.loaded_context || !this.loaded_context.title) {
					this.running = false;
					this.last_message = '';
					this.input_error = message('f2c_no_such_user', 'No such user: $1', [user]);
					this.form_is_visible = true;
					return;
				}
				this.syncRoute('user', userId);
				this.getFlickrFiles({
					method: 'flickr.photos.search',
					result_key: 'photos',
					user_id: userId
				});
			},
			async doRunPhotoset(photosetId) {
				const generation = this.load_generation;
				this.loaded_context = { type: 'photoset', id: photosetId, label: photosetId, href: '' };
				await this.hydrateLoadedContext('photoset', photosetId);
				if (generation !== this.load_generation) return;
				if (!this.loaded_context || !this.loaded_context.title) {
					this.running = false;
					this.last_message = '';
					this.input_error = message('f2c_no_such_photoset', 'No such photoset: $1', [photosetId]);
					this.form_is_visible = true;
					return;
				}
				this.syncRoute('photoset', photosetId);
				this.getFlickrFiles({
					method: 'flickr.photosets.getPhotos',
					result_key: 'photoset',
					privacy_filter: 1,
					photoset_id: photosetId
				});
			},
			async doRunGroup(groupId) {
				const generation = this.load_generation;
				const realGroupId = await Magpie.flickr.resolveGroupName(this.apiKey, groupId);
				if (generation !== this.load_generation) return;
				if (!realGroupId) {
					this.running = false;
					this.last_message = '';
					this.input_error = message('f2c_no_such_group', 'No such group: $1', [groupId]);
					this.form_is_visible = true;
					return;
				}
				this.loaded_context = { type: 'group', id: realGroupId, label: groupId, href: '' };
				await this.hydrateLoadedContext('group', realGroupId);
				if (generation !== this.load_generation) return;
				if (!this.loaded_context || !this.loaded_context.title) {
					this.running = false;
					this.last_message = '';
					this.input_error = message('f2c_no_such_group', 'No such group: $1', [groupId]);
					this.form_is_visible = true;
					return;
				}
				this.syncRoute('group', realGroupId);
				this.getFlickrFiles({
					method: 'flickr.groups.pools.getPhotos',
					result_key: 'photos',
					group_id: realGroupId
				});
			},
			smartDetect(input) {
				input = String(input || '').trim();
				if (!input) return null;
				let match;
				if ((match = input.match(/flic\.kr\/p\/([1-9A-HJ-NP-Za-km-z]+)/))) {
					const id = Magpie.flickr.decodeBase58(match[1]);
					if (id) return { type: 'photo', value: id };
				}
				if ((match = input.match(/\/photos\/[^/]+\/(\d+)/))) return { type: 'photo', value: match[1] };
				if ((match = input.match(/\/albums\/(\d+)/))) return { type: 'photoset', value: match[1] };
				if ((match = input.match(/\/groups\/([^/]+)/))) return { type: 'group', value: match[1] };
				if ((match = input.match(/\/people\/([^/]+)/))) return { type: 'user', value: match[1] };
				if (/^\d+$/.test(input)) {
					if (input.length >= 14 && input.length <= 20) return { type: 'photoset', value: input };
					if (input.length < 14) return { type: 'photo', value: input };
					return null;
				}
				if (input.includes('@')) return { type: 'user', value: input };
				if (input.includes(',')) return { type: 'photo', value: input };
				return { type: 'user', value: input };
			},
			async doRun() {
				try {
					await this.startRun();
				} catch (error) {
					this.logError(error.message || String(error));
					this.form_is_visible = true;
				}
			},
			async startRun() {
				this.last_message = '';
				this.last_error = '';
				this.input_error = '';
				this.tag_warning = '';
				if (!this.auth.checked) return;
				if (!this.auth.ok) {
					this.form_is_visible = true;
					this.input_error = 'Log in to start this transfer.';
					return;
				}
				if (this.has_run && this.files.length > 0) {
					if (!window.confirm('Re-running will clear the current results. Continue?')) return;
				}
				const trimmed = String(this.combined_input || '').trim();
				if (!trimmed) {
					this.input_error = 'This field is required.';
					return;
				}
				this.validateTag();

				this.last_message = 'Running…';
				this.running = true;
				this.has_run = false;
				this.files = [];
				this.transfers_running = 0;
				this.stop_transfers = false;
				this.form_is_visible = false;
				this.pd_rationale = '';
				this.non_free_filtered = 0;
				this.no_url_filtered = 0;
				this.hide_files_on_commons = true;
				this.populating_categories = false;
				this.category_population_message = '';
				this.load_generation++;

				const pending = this.pending_route;
				this.pending_route = null;
				if (pending) {
					if (pending.type === 'user') await this.doRunUser(pending.value);
					else if (pending.type === 'photoset') await this.doRunPhotoset(pending.value);
					else if (pending.type === 'group') await this.doRunGroup(pending.value);
					else if (pending.type === 'photo') await this.doRunPhotos(Magpie.commons.splitPhotoIds(pending.value));
					return;
				}

				const result = this.smartDetect(trimmed);
				if (!result) {
					this.running = false;
					this.last_message = '';
					this.form_is_visible = true;
					this.input_error = 'Nothing to work with';
					return;
				}
				if (result.type === 'user') await this.doRunUser(result.value);
				else if (result.type === 'photoset') await this.doRunPhotoset(result.value);
				else if (result.type === 'group') await this.doRunGroup(result.value);
				else if (result.type === 'photo') await this.doRunPhotos(Magpie.commons.splitPhotoIds(result.value));
			},
			stopTransfers() {
				this.stop_transfers = true;
			},
			onRetry(file) {
				file.is_checked = true;
				this.transferAll();
			},
			nextTransferable() {
				return this.files.find((file) =>
					file.is_checked
					&& file.f2c_status === 'READY'
					&& file.existing_filename_on_commons === ''
					&& file.filename_status !== 'exists'
					&& file.filename_status !== 'simple'
					&& file.filename_status !== 'blacklisted');
			},
			transferAll() {
				if (this.transfers_running >= MAX_CONCURRENT_TRANSFERS) return;
				if (this.stop_transfers) {
					if (this.transfers_running === 0) this.stop_transfers = false;
					return;
				}
				const file = this.nextTransferable();
				if (!file) {
					if (this.transfers_running === 0) this.stop_transfers = false;
					return;
				}
				file.f2c_status = 'TRANSFER';
				file.error_message = '';
				this.transfers_running++;
				setTimeout(() => this.transferAll(), 0);
				setTimeout(() => this.transferAll(), 0);
				this.runOneTransfer(file).finally(() => {
					this.transfers_running--;
					setTimeout(() => this.transferAll(), 10);
				});
			},
			async runOneTransfer(file) {
				const categoriesList = String(file.user_categories || '').trim()
					.split('\n').map((category) => category.trim()).filter(Boolean);

				let filename = file.new_title.trim();
				while (filename.length > 250) filename = filename.replace(/.(\.[a-z]+)$/i, '$1');

				let newDesc = file.new_description.trim();
				if (newDesc === '' && this.use_flickr_descriptions) {
					newDesc = Magpie.flickr.text(file.description && file.description._content).trim();
				}
				newDesc = Magpie.commons.sanitizeDescription(newDesc);
				const extra = this.add2every_desc.trim();
				if (extra) newDesc = (newDesc + '\n' + extra).trim();

				let result;
				try {
					result = await Magpie.flickr.informationTemplate(
						file.id,
						newDesc,
						categoriesList.length === 0 ? file.auto_categories : false);
				} catch (error) {
					result = { template: Magpie.flickr.fallbackTemplate(file, newDesc) };
				}
				if (result.error) {
					file.f2c_status = 'ERROR';
					file.error_message = result.error;
					return;
				}

				let wikitext = result.template;
				if (this.pd_rationale_template
					&& Magpie.flickr.GENERIC_PD_LICENSE_IDS.has(String(file.license))) {
					wikitext += '\n{{' + this.pd_rationale_template + '}}';
				}
				for (const category of categoriesList) {
					wikitext += '\n[[Category:' + Magpie.commons.ucFirst(category) + ']]';
				}
				const footer = this.append_everywhere.trim();
				if (footer) wikitext = (wikitext + '\n' + footer).trim();

				try {
					const answer = await Magpie.api.uploadFromUrl({
						url: file.url_best || file.url_o,
						newfile: filename,
						desc: wikitext,
						comment: 'Transferred from Flickr via #flickr2commons',
						ignorewarnings: true,
						blockwarnings: '1'
					});
					if (!answer.error || answer.error === 'OK') {
						const uploaded = answer.res && answer.res.upload && answer.res.upload.filename;
						file.is_checked = true;
						file.f2c_status = 'DONE';
						file.existing_filename_on_commons = uploaded || filename;
					} else {
						file.f2c_status = 'ERROR';
						file.error_message = String(answer.error);
						const warnings = answer.res && answer.res.upload && answer.res.upload.warnings;
						const duplicate = (warnings && warnings.duplicate && warnings.duplicate[0])
							|| (warnings && warnings['duplicate-archive']);
						if (duplicate) {
							file.existing_filename_on_commons = String(duplicate).replace(/^File:/, '');
						}
						if (/fileexists-no-change/.test(file.error_message)) {
							const match = file.error_message.match(/\[\[:?File:(.+?)\]\]/);
							if (match) {
								file.f2c_status = 'DONE';
								file.existing_filename_on_commons = match[1];
								file.error_message = '';
							}
						}
					}
				} catch (error) {
					file.f2c_status = 'ERROR';
					file.error_message = error.message || String(error);
				}
			}
		}
	};
})();
