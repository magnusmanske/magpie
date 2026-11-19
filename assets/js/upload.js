/* A small sequential upload queue. One upload at a time keeps the wiki and
   the OAuth rate limits happy; the server also pauses after each upload. */

window.Magpie = window.Magpie || {};

Magpie.makeUploader = function (items) {
	return {
		busy: false,
		stopped: false,

		async run(options) {
			if (this.busy) return;
			this.busy = true;
			this.stopped = false;
			const pause = (options && options.pause) || 1000;
			try {
				for (const item of items()) {
					if (this.stopped) break;
					if (item.status === 'done' || item.skip) continue;
					item.status = 'uploading';
					item.message = '';
					try {
						const result = await Magpie.api.uploadFromUrl({
							url: item.sourceUrl,
							newfile: item.newfile,
							desc: item.desc,
							comment: item.comment,
							ignorewarnings: item.ignorewarnings,
							blockwarnings: item.blockwarnings
						});
						if (result.error && result.error !== 'OK') {
							item.status = 'error';
							item.message = result.error;
						} else {
							item.status = 'done';
							item.page = Magpie.commonsPage(item.newfile);
							item.message = 'Uploaded';
						}
					} catch (error) {
						item.status = 'error';
						item.message = String(error.message || error);
					}
					await Magpie.sleep(pause);
				}
			} finally {
				this.busy = false;
			}
		},

		stop() { this.stopped = true; }
	};
};
