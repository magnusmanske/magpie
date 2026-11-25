#!/usr/bin/env python3
"""Generate the Tooltranslate import SQL for the `magpie` tool.

Translations are not stored in this repository. The current published data is
read from Tooltranslate, the new interface keys below are added, and the result
is written as idempotent SQL to target/magpie-i18n.sql.

    python3 scripts/build_i18n.py
    # import target/magpie-i18n.sql on Toolforge as the tooltranslate tool
    # then call api.php?mode=update_json&toolname=magpie

The SQL updates English (the reference) and only adds missing translations in
other languages, so translators' current versions are kept.
"""

from __future__ import annotations

import json
import urllib.request
from datetime import datetime
from pathlib import Path
from urllib.error import URLError

ROOT = Path(__file__).resolve().parent.parent
SQL_OUT = ROOT / "target" / "magpie-i18n.sql"
DATA = "https://tools-static.wmflabs.org/tooltranslate/data/"
USER_AGENT = "magpie-i18n-import/1.0 (https://magpie.toolforge.org/)"

TOOL = "magpie"
LABEL = "magpie"
URL = "https://magpie.toolforge.org/"
OWNER = "Magnus Manske"
SOURCE_TOOL = "flickr2commons"

# New strings for the unified interface. Existing Flickr2Commons keys are kept
# as they are; these keys cover the shell and the other three tools.
NEW_EN = {
    # Shell and home page
    "magpie_title": "magpie — files to Wikimedia Commons",
    "magpie_home_heading": "Move files to Wikimedia Commons",
    "magpie_home_intro": "Collects shiny things (files) from the web and takes them back to the nest (Wikimedia Commons).",
    "magpie_tool_flickr2commons": "Flickr2Commons",
    "magpie_tool_flickr2commons_desc": "Batch-upload free Flickr photos, with duplicate checks.",
    "magpie_tool_url2commons": "Url2Commons",
    "magpie_tool_url2commons_desc": "Upload files from URLs, one or many at a time.",
    "magpie_tool_geograph2commons": "Geograph2Commons",
    "magpie_tool_geograph2commons_desc": "Transfer a Geograph photo with its description and coordinates.",
    "magpie_tool_commonshelper": "CommonsHelper",
    "magpie_tool_commonshelper_desc": "Move a file from another wiki, translating its description and license.",
    "magpie_logged_in": "Logged in",
    "magpie_log_in_oauth": "Log in with OAuth",
    "magpie_footer": "Files go to Wikimedia Commons. Only upload media whose license allows reuse.",
    "magpie_language": "Interface language",
    "magpie_not_logged_in": "You are not logged in.",
    "magpie_login_to_upload": "Log in with OAuth to upload under your own Commons account.",
    "magpie_login_hint": "to upload under your own Commons account.",
    "magpie_login_required": "Log in before starting an upload.",

    # Common interface
    "magpie_upload": "Upload",
    "magpie_uploading": "Uploading...",
    "magpie_checking": "Checking...",
    "magpie_uploaded": "Uploaded",
    "magpie_uploaded_at": "Uploaded:",
    "magpie_upload_success": "SUCCESS!",
    "magpie_uploading_file": "Uploading file to Commons...",
    "magpie_preview": "Preview",
    "magpie_source": "Source",
    "magpie_status": "Status",
    "magpie_files": "Files",
    "magpie_file_name": "File name",
    "magpie_new_name": "New name on Commons",
    "magpie_project": "Project",
    "magpie_filename_available": "Filename available.",
    "magpie_retry": "Retry",
    "magpie_loading": "Loading…",
    "magpie_checking_login": "Checking login",
    "magpie_checking_filename": "Checking filename",
    "magpie_login_failed": "Login failed. The connection to Wikimedia was interrupted; please log in again.",
    "magpie_api_failed": "The API failed ($1)",
    "magpie_enter_file_name": "Please name the file on the source wiki.",
    "magpie_source_url_unknown": "The source URL is unknown; load the description first.",

    # Url2Commons
    "magpie_u2c_intro": "Url2Commons uploads files from generic URLs to Wikimedia Commons.",
    "magpie_urls": "URLs",
    "magpie_urls_hint": "One URL per line. After the URL, an optional file name. After |, an optional description key for $DESCRIPTOR$. Use $NL$ for a newline and $US$ for an underscore.",
    "magpie_description_template": "Description template",
    "magpie_desc_hint": "$DESCRIPTOR$ is replaced per file; $URL$ with the source URL.",
    "magpie_simulate": "Simulate",
    "magpie_preview_description": "Preview description",
    "magpie_description_preview": "Description preview",
    "magpie_preview_first_url": "Placeholders filled in from the first URL line.",
    "magpie_preview_no_url": "No URL entered, so $DESCRIPTOR$ and $URL$ are empty.",
    "magpie_preview_could_not_render": "Commons could not render this description.",
    "magpie_preview_unreachable": "Could not reach the Commons API to render the preview.",
    "magpie_all_simulations_ok": "All simulations successful, you can upload if you are logged in!",
    "magpie_all_uploaded": "All files uploaded!",
    "magpie_simulations_failed": "$1 simulations failed; see the details above.",
    "magpie_simulation_failed": "$1 simulation failed; see the details above.",
    "magpie_uploads_failed": "$1 uploads failed; see the details above.",
    "magpie_upload_failed_count": "$1 upload failed; see the details above.",
    "magpie_enter_url": "Please enter at least one URL.",
    "magpie_duplicate_url": "You are already trying to upload a file with this URL!",
    "magpie_duplicate_filename": "You are already trying to upload a file with this filename!",
    "magpie_unsupported_type": "\"$1\" is not a supported file name!",
    "magpie_filename_exists_on_commons": "A file of this name already exists on Commons: $1 — please give this upload a different name.",
    "magpie_could_not_check_filename": "Could not check the filename on Commons; please try again.",
    "magpie_could_not_check_file": "Could not check this file: $1",
    "magpie_upload_request_failed": "The upload request itself failed ($1)",
    "magpie_upload_identical_exists": "the identical file is already on Commons as $1",
    "magpie_upload_other_name": "a different file already uses this name: $1",
    "magpie_upload_equivalent_name": "a file with an equivalent name exists: $1",
    "magpie_upload_deleted_before": "an identical file was uploaded and deleted before: $1",
    "magpie_upload_name_deleted": "this filename was deleted before: $1",
    "magpie_upload_would_rename": "Commons would rename this file to \"$1\"",
    "magpie_upload_empty": "the file downloaded from the source URL was empty (the source may block automated downloads)",
    "magpie_upload_type_not_allowed": "this file type is not allowed on Commons",
    "magpie_upload_too_large": "the file is larger than Commons allows",
    "magpie_upload_old_version_deleted": "an earlier version of this file was deleted",
    "magpie_upload_not_uploaded": "Not uploaded: $1.",
    "magpie_upload_generic_failed": "the upload failed, but Commons gave no reason. Please retry; if it keeps failing, report this URL.",
    "magpie_upload_failure_error": "ERROR: $1",

    # Geograph2Commons
    "magpie_g2c_intro": "Transfer a photo from Geograph with its description and reuse terms.",
    "magpie_server": "Server",
    "magpie_photo_id": "Photo ID",
    "magpie_new_filename_optional": "New file name (optional)",
    "magpie_extra_categories": "Extra categories, one per line",
    "magpie_load_photo": "Load photo",
    "magpie_hires_image": "Hi-res image",
    "magpie_numeric_photo_id": "Please enter a numeric photo ID.",
    "magpie_could_not_load_photo": "Could not load photo $1 from $2",
    "magpie_no_description_check_id": "Could not get a description; check the photo ID.",
    "magpie_no_title_check_id": "Could not get a title; check the photo ID.",
    "magpie_no_image_url": "Could not find the image URL.",

    # CommonsHelper
    "magpie_ch_intro": "Read a file from another wiki and build the Commons description page. The original page's description, license, and upload history are translated where possible.",
    "magpie_file_on_wiki": "File name on that wiki",
    "magpie_remove_source_categories": "Remove source categories",
    "magpie_ignore_warnings": "Ignore warnings",
    "magpie_direct_upload": "Direct upload",
    "magpie_get_text": "Get text",
    "magpie_upload_to_commons": "Upload to Commons",
    "magpie_use_manual_upload": "Use the manual upload button below.",
    "magpie_free_license_recognised": "A free license was recognised.",
    "magpie_no_free_license": "No free license was recognised. Check the text before uploading.",
    "magpie_no_free_license_not_uploading": "No free license was recognised; not uploading.",
    "magpie_source_file": "Source file",
    "magpie_manual_upload": "Manual upload",
    "magpie_copy_text": "Copy text",
    "magpie_text_copied": "Text copied.",
    "magpie_copy_failed": "Could not copy; select the text and copy it manually.",
    "magpie_nowcommons_heading": "Now that it is on Commons",
    "magpie_add_to_original": "Add this to the original file page:",
    "magpie_add_nowcommons": "Add {{NowCommons}}",
    "magpie_edit_original": "Edit original page",
    "magpie_delete_original": "Delete original file",
    "magpie_nowcommons_added": "The template was added to the original page.",
    "magpie_nowcommons_already": "The page already contains the template.",
    "magpie_nowcommons_confirm": "Add $1 to $2?",
    "magpie_name_changed": "\"$1\" already exists on Commons; the name was changed to \"$2\". Check the name before uploading.",
    "magpie_no_free_name": "Could not find a free file name on Commons for \"$1\".",
    "magpie_login_before_direct": "Log in before starting a direct upload.",
    "magpie_name_changed_review": "The file name was changed because it already exists; review it and upload.",

    # Flickr2Commons additions
    "magpie_new_search": "New search",
    "magpie_author": "Author",
    "magpie_license": "License",
    "magpie_files_loaded": "$1 freely licensed files loaded",
    "magpie_file_loaded": "$1 freely licensed file loaded",
    "magpie_loaded_source_aria": "Loaded Flickr source",
    "magpie_loaded_context_user": "Flickr account",
    "magpie_loaded_context_photoset": "Flickr album",
    "magpie_loaded_context_group": "Flickr group",
    "magpie_loaded_context_photo": "Flickr photo",
    "magpie_loaded_context_source": "Flickr source",
    "magpie_matching_files": "$1 matching files",
    "magpie_matching_file": "$1 matching file",
    "magpie_upload_selected": "Upload selected files",
    "magpie_retry_failed": "Retry $1 failed uploads",
    "magpie_description_language": "Description language",
    "magpie_description_language_hint": "Optional language code (for example en or de) used to wrap each description in a language template. Leave blank to add no wrapper.",
    "magpie_populate": "Populate",
    "magpie_populate_categories": "Populate categories",
    "magpie_loading_suggestions": "Loading suggestions for $1 files…",
    "magpie_suggestions_added": "$1 suggestions added for review.",
    "magpie_suggestion_added": "$1 suggestion added for review.",
    "magpie_no_new_suggestions": "No new suggestions found.",
    "magpie_could_not_load_suggestions": "Could not load category suggestions.",
    "magpie_categories_populated": "$1 files populated",
    "magpie_no_new_suggestions_count": "$1 had no new suggestions",
    "magpie_failed_count": "$1 failed",
    "magpie_categories_review": "$1. Review the category fields below before uploading.",
    "magpie_cannot_upload": "This file cannot be uploaded as it is",
    "magpie_uploads_in_progress": "Uploads in progress",
    "magpie_return_to_start_confirm": "Return to the start form? The current load and results will be cleared.",
    "magpie_flickr_key_missing": "The Flickr API key is not configured.",
    "magpie_flickr_description": "Flickr Description",
    "magpie_pd_rationale_aria": "Public domain licence template",
    "magpie_flickr_api_error": "The Flickr API returned an error",
    "magpie_flickr_no_result": "The Flickr API returned no $1",
    "magpie_http_error": "HTTP $1",
    "magpie_flinfo_server_failure": "Flinfo server failure. Try again.",
    "magpie_flinfo_internal_error": "Flinfo internal error.",
    "magpie_flinfo_bad_user": "Flinfo says 'bad user'.",
    "magpie_flinfo_invalid_id": "Flinfo says 'invalid ID'.",
    "magpie_flinfo_missing_id": "Flinfo says 'missing ID'.",
    "magpie_flinfo_issue": "FLinfo issue: $1",
    "magpie_flickr_photo_load_failed": "Could not load the Flickr photo. Check the ID and that the Flickr API key is configured.",
}


def fetch_json(path: str):
    request = urllib.request.Request(DATA + path, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except (URLError, TimeoutError, json.JSONDecodeError):
        return {}


def load_tool(tool: str, language: str) -> dict[str, str]:
    data = fetch_json(f"{tool}/{language}.json")
    return {key: value for key, value in data.items() if key != "@metadata"}


def escape_sql(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "''")


def sql_literal(value: str) -> str:
    return "0x" + value.encode("utf-8").hex()


def main() -> None:
    source_info = fetch_json(f"{SOURCE_TOOL}/toolinfo.json")
    source_languages = {str(lang) for lang in source_info.get("languages", [])}
    info = fetch_json(f"{TOOL}/toolinfo.json")
    languages = {str(lang) for lang in info.get("languages", [])}
    if not languages:
        languages = set(source_languages)
    else:
        languages |= source_languages
    languages.add("en")

    english = load_tool(TOOL, "en") or load_tool(SOURCE_TOOL, "en")
    merged_en = {**english, **NEW_EN}

    now = datetime.now().strftime("%Y%m%d%H%M%S")
    lines = [
        "-- Magpie Tooltranslate import. Generated by scripts/build_i18n.py.",
        "START TRANSACTION;",
        "INSERT INTO tool (name, label, url, owner)",
        f"SELECT '{TOOL}', '{LABEL}', '{URL}', '{OWNER}' FROM DUAL",
        f"WHERE NOT EXISTS (SELECT 1 FROM tool WHERE name = '{TOOL}');",
        f"SET @magpie_tool := (SELECT id FROM tool WHERE name = '{TOOL}' ORDER BY id LIMIT 1);",
    ]

    for language in sorted(languages):
        base = load_tool(TOOL, language)
        if not base and language in source_languages:
            base = load_tool(SOURCE_TOOL, language)
        if language == "en":
            translated = dict(merged_en)
        else:
            by_value: dict[str, list[str]] = {}
            for key, value in english.items():
                by_value.setdefault(value, []).append(key)
            translated = {}
            for key, value in merged_en.items():
                if key in base:
                    translated[key] = base[key]
                    continue
                for candidate in by_value.get(value, []):
                    if candidate in base:
                        translated[key] = base[candidate]
                        break
        for key, value in translated.items():
            key_sql = escape_sql(key)
            json_sql = sql_literal(json.dumps(value, ensure_ascii=False))
            if language == "en":
                lines.append(
                    "UPDATE translation SET current=0 "
                    f"WHERE tool_id=@magpie_tool AND language='{language}' AND `key`='{key_sql}' "
                    f"AND current=1 AND json <> {json_sql};"
                )
            lines.append(
                "INSERT INTO translation (tool_id, language, `key`, json, user, timestamp, current) "
                f"SELECT @magpie_tool, '{language}', '{key_sql}', {json_sql}, '{OWNER}', '{now}', 1 "
                "FROM DUAL WHERE NOT EXISTS ("
                "SELECT 1 FROM translation "
                f"WHERE tool_id=@magpie_tool AND language='{language}' AND `key`='{key_sql}' AND current=1);"
            )

    lines.append("COMMIT;")
    SQL_OUT.parent.mkdir(parents=True, exist_ok=True)
    SQL_OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(merged_en)} English keys; {len(languages)} languages")
    print(f"SQL: {SQL_OUT}")


if __name__ == "__main__":
    main()
