/* One Flickr photo row: editable filename, description and categories, plus
   the Commons checks and transfer state that belong to that photo. */

window.Magpie = window.Magpie || {};
Magpie.Components = Magpie.Components || {};

Magpie.Components.flickrFile = {
	name: 'flickr-file',
	props: {
		file: { type: Object, required: true },
		hide_files_on_commons: { type: Boolean, default: false },
		use_flickr_descriptions: { type: Boolean, default: false }
	},
	data() {
		return {
			category_loading: false,
			category_message: '',
			selected_description_tags: [],
			is_portrait: false
		};
	},
	computed: {
		thumbnail_url() {
			return Magpie.flickr.thumbnailUrl(this.file.url_s || this.file.url_q);
		},
		flickr_description() {
			return Magpie.flickr.text(this.file.description && this.file.description._content).trim();
		},
		uses_flickr_description() {
			return this.use_flickr_descriptions
				&& String(this.file.new_description || '').trim() === ''
				&& this.flickr_description !== '';
		},
		tag_list() {
			const tags = this.file.display_tags || String(this.file.tags || '').split(/\s+/);
			return tags
				.map((value) => String(value).trim())
				.filter(Boolean)
				.sort((a, b) => a.localeCompare(b));
		},
		is_eligible() {
			return this.file.existing_filename_on_commons === ''
				&& this.file.filename_status !== 'exists'
				&& this.file.filename_status !== 'simple'
				&& this.file.filename_status !== 'blacklisted'
				&& this.file.f2c_status === 'READY';
		},
		filename_blocks_selection() {
			return this.file.filename_status === 'exists'
				|| this.file.filename_status === 'simple'
				|| this.file.filename_status === 'blacklisted';
		},
		is_locked() {
			return this.file.f2c_status === 'TRANSFER' || this.file.f2c_status === 'DONE';
		},
		is_hidden() {
			return this.hide_files_on_commons
				&& this.file.existing_filename_on_commons !== ''
				&& this.file.f2c_status !== 'DONE';
		},
		row_class() {
			return [
				'flickr-file',
				'flickr-file--' + String(this.file.f2c_status || 'read').toLowerCase(),
				{ 'flickr-file--portrait': this.is_portrait }
			];
		},
		status_label() {
			switch (this.file.f2c_status) {
				case 'TRANSFER': return 'Transferring…';
				case 'DONE': return 'Done';
				case 'ERROR': return 'Error';
				default: return '';
			}
		}
	},
	watch: {
		'file.new_title': {
			immediate: true,
			handler() { this.refreshFilenameStatus(); }
		},
		'file.is_checked'(checked) {
			if (checked && this.filename_blocks_selection) this.file.is_checked = false;
		}
	},
	methods: {
		detectThumbnailOrientation(event) {
			this.is_portrait = event.target.naturalHeight > event.target.naturalWidth;
		},
		isTagSelected(tag) {
			return this.selected_description_tags.some(
				(value) => value.toLocaleLowerCase() === tag.toLocaleLowerCase());
		},
		addTagToDescription(tag) {
			if (this.is_locked) return;
			const selectedIndex = this.selected_description_tags.findIndex(
				(value) => value.toLocaleLowerCase() === tag.toLocaleLowerCase());
			if (selectedIndex !== -1) {
				const description = this.file.new_description || '';
				const index = description.toLocaleLowerCase().lastIndexOf(tag.toLocaleLowerCase());
				if (index !== -1) {
					let start = index;
					let end = index + tag.length;
					if (description.slice(Math.max(0, start - 2), start) === ', ') start -= 2;
					else if (description.slice(end, end + 2) === ', ') end += 2;
					this.file.new_description = (description.slice(0, start) + description.slice(end)).trimEnd();
				}
				this.selected_description_tags.splice(selectedIndex, 1);
				return;
			}
			if (this.selected_description_tags.length === 0) {
				const description = (this.file.new_description || '').trimEnd();
				this.file.new_description = description ? description + '\n\n' + tag : tag;
			} else {
				this.file.new_description = this.file.new_description.trimEnd() + ', ' + tag;
			}
			this.selected_description_tags.push(tag);
			this.$nextTick(() => {
				const input = document.getElementById('description_' + this.file.id);
				if (input) input.scrollTop = input.scrollHeight;
			});
		},
		async populateCategories() {
			if (this.category_loading || this.is_locked) return;
			this.category_loading = true;
			this.category_message = '';
			try {
				let suggestions = [];
				let suggestionsFailed = false;
				try {
					suggestions = await Magpie.flickr.suggestedCategories(this.file.id);
				} catch (error) {
					suggestionsFailed = true;
				}
				const description = Magpie.flickr.text(this.file.description && this.file.description._content)
					+ '\n' + (this.file.new_description || '');
				const candidates = suggestions.concat(Magpie.commons.extractSpeakerCategories(description));
				const categories = String(this.file.user_categories || '').split('\n')
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
				this.file.user_categories = categories.join('\n');
				this.file.auto_categories = false;
				this.category_message = added
					? added + ' ' + (added === 1 ? 'suggestion' : 'suggestions') + ' added for review.'
					: (suggestionsFailed ? 'Could not load category suggestions.' : 'No new suggestions found.');
			} catch (error) {
				this.category_message = 'Could not load category suggestions.';
			} finally {
				this.category_loading = false;
			}
		},
		cleanFilename() {
			this.file.new_title = Magpie.commons.cleanFilenameSpacing(this.file.new_title);
		},
		async refreshFilenameStatus() {
			this.file.filename_status = Magpie.commons.statusFromCache(this.file.new_title);
			if (this.filename_blocks_selection) this.file.is_checked = false;
			if (this.file.filename_status !== 'checking') return;

			const title = this.file.new_title;
			await Magpie.commons.lookupFilename(title);
			if (Magpie.commons.normalizeTitle(this.file.new_title) !== Magpie.commons.normalizeTitle(title)) return;
			this.file.filename_status = Magpie.commons.statusFromCache(this.file.new_title);
			if (this.filename_blocks_selection) this.file.is_checked = false;
		},
		retry() {
			this.file.f2c_status = 'READY';
			this.file.error_message = '';
			this.$emit('retry', this.file);
		},
		commonsPage(name) {
			return Magpie.commonsPage(name);
		}
	},
	template: `
	<div v-show="!is_hidden" :class="row_class" :data-flickr-file-id="file.id">
		<div class="flickr-file__select">
			<input v-if="file.existing_filename_on_commons === '' || file.f2c_status === 'DONE'"
				type="checkbox" v-model="file.is_checked" :id="'file_cb_' + file.id"
				:disabled="!is_eligible" :title="is_eligible ? '' : 'This file cannot be uploaded as it is'">
		</div>

		<div class="flickr-file__thumb">
			<a target="_blank" rel="noopener" :href="file.page">
				<img :src="thumbnail_url" loading="lazy" alt="" width="150" height="150"
					@load="detectThumbnailOrientation">
			</a>
			<div v-if="status_label" class="flickr-file__status-pill">{{ status_label }}</div>
		</div>

		<div class="flickr-file__body">
			<div v-if="file.existing_filename_on_commons !== ''" class="file_on_commons">
				<div>
					This file exists on Wikimedia Commons as
					<a target="_blank" rel="noopener" :href="commonsPage(file.existing_filename_on_commons)">
						{{ file.existing_filename_on_commons }}
					</a>
				</div>
				<div>
					<a target="_blank" rel="noopener" :href="commonsPage(file.existing_filename_on_commons)">
						<img :src="'https://commons.wikimedia.org/wiki/Special:Redirect/file/'
								+ encodeURIComponent(file.existing_filename_on_commons) + '?width=120'"
							loading="lazy" alt="" height="120">
					</a>
				</div>
			</div>

			<div v-else class="flickr-file__form">
				<label class="f2c-file-field-label" :for="'filename_' + file.id">Filename</label>
				<input :id="'filename_' + file.id" type="text" class="form-control magpie-mono"
					v-model="file.new_title" @blur="cleanFilename" :disabled="is_locked">

				<div v-if="file.filename_status === 'checking'" class="analysis-progress f2c-filename-checking"
					role="progressbar" aria-label="Checking filename"></div>

				<div v-if="['exists', 'deleted', 'simple', 'blacklisted'].includes(file.filename_status)"
					class="f2c-filename-notice" :class="'f2c-filename-notice--' + file.filename_status">
					<svg class="f2c-filename-notice__icon" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
						<path d="M19 19H1v-1.8L9.444 1h1.112L19 17.2zM9 15v2h2v-2zm0-8v6h2V7z"/>
					</svg>
					<div v-if="file.filename_status === 'exists'" class="f2c-filename-notice__content">
						<strong>Filename already in use</strong>
						<p>A file with this filename already exists on Wikimedia Commons. Choose a different filename before uploading.</p>
						<a target="_blank" rel="noopener" :href="commonsPage(file.new_title)">View existing file</a>
					</div>
					<div v-else-if="file.filename_status === 'deleted'" class="f2c-filename-notice__content">
						<strong>Filename was previously deleted</strong>
						<p>A file with this filename was deleted from Wikimedia Commons. Review the deletion log before reusing it.</p>
						<a target="_blank" rel="noopener"
							:href="'https://commons.wikimedia.org/w/index.php?title=Special:Log&page=File:'
								+ encodeURIComponent(file.new_title) + '&type=delete'">View deletion log</a>
					</div>
					<div v-else class="f2c-filename-notice__content">
						<strong>Filename is too generic</strong>
						<p>Add a clear, descriptive title so the file can be identified on Wikimedia Commons.</p>
					</div>
				</div>

				<label class="f2c-file-field-label" :for="'description_' + file.id">Description</label>
				<textarea :id="'description_' + file.id" class="form-control" rows="5"
					v-model="file.new_description" :disabled="is_locked"
					title="Enter a description for this file."></textarea>

				<div class="flickr-file__source-desc" :class="{ 'flickr-file__source-desc--active': uses_flickr_description }">
					<strong class="flickr-file__source-label">Flickr Description</strong>
					<p class="small mb-0">{{ flickr_description || '—' }}</p>
				</div>

				<div v-if="tag_list.length" class="flickr-file__tags">
					<strong class="flickr-file__source-label">Flickr tags</strong>
					<small class="f2c-field-hint">Select tags to append them, comma-separated, to the description.</small>
					<div class="flickr-file__tag-list">
						<button v-for="tag in tag_list" :key="tag" type="button" class="flickr-file__tag-button"
							:class="{ 'flickr-file__tag-button--selected': isTagSelected(tag) }"
							:aria-pressed="isTagSelected(tag).toString()"
							:disabled="is_locked" @click.prevent="addTagToDescription(tag)">{{ tag }}</button>
					</div>
				</div>

				<label class="f2c-file-field-label" :for="'categories_' + file.id">Categories</label>
				<p class="f2c-field-hint">Enter one category per line, without the Category: prefix or square brackets.</p>
				<textarea :id="'categories_' + file.id" class="form-control" rows="3"
					v-model="file.user_categories" :disabled="is_locked"
					title="Enter categories for this file."></textarea>
				<div class="f2c-file-category-actions">
					<button type="button" class="btn btn-sm btn-outline-primary"
						:disabled="category_loading || is_locked" @click.prevent="populateCategories">
						{{ category_loading ? 'Loading…' : 'Populate' }}
					</button>
				</div>
				<small v-if="category_message" class="f2c-file-field-message" aria-live="polite">{{ category_message }}</small>

				<div v-if="file.error_message" class="f2c-upload-error mt-2" role="alert">
					<span class="f2c-upload-error__content">
						<strong>Upload failed</strong>
						<span>{{ file.error_message }}</span>
					</span>
					<button v-if="file.f2c_status === 'ERROR'" type="button" class="btn btn-sm btn-outline-danger"
						@click.prevent="retry" title="Retry">Retry</button>
				</div>
			</div>
		</div>
	</div>`
};
