//! Building the Commons description page from a local file page.
//!
//! This is a port of `get_upload_text()` from the PHP CommonsHelper. It keeps
//! the PHP behaviour, including its quirks, so existing transfers keep their
//! familiar output; deliberate deviations are noted inline.

use super::data::{Catalog, upper_first};
use super::source::SourceInfo;
use regex::{NoExpand, Regex, RegexBuilder};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use wikimisc::wiki::Wiki;
use wikimisc::wiki_api;

/// The generated wikitext and what the caller still has to decide.
#[derive(Debug, Clone)]
pub struct UploadText {
    pub text: String,
    pub is_good: bool,
    pub warnings: Vec<String>,
}

pub async fn build(
    http: &reqwest::Client,
    catalog: &Catalog,
    source: &SourceInfo,
    image: &str,
    language: &str,
    project: &str,
    remove_categories: bool,
) -> Result<UploadText, String> {
    let image = remove_image_namespace(catalog, image);
    let language2 = if language.is_empty() && project == "wikisource" {
        project.to_string()
    } else if project != "wikipedia" {
        format!("{project}:{language}")
    } else {
        language.to_string()
    };
    let mut warnings = Vec::new();

    // The original wikitext, with every link made a link on the source wiki.
    let mut text = source.text.replace("[[", &format!("[[:{language2}:"));

    // PermissionOTRS templates are carried into the permission field.
    let otrs_pattern = RegexBuilder::new(r"\{\{PermissionOTRS[^}]*\}\}")
        .case_insensitive(true)
        .build()
        .map_err(|e| e.to_string())?;
    let otrs_data: Vec<String> = otrs_pattern
        .find_iter(&text)
        .map(|m| m.as_str().to_string())
        .collect();

    // German OTRS templates are removed from the text and appended later.
    let mut otrs_orig = String::new();
    if language == "de" {
        let pattern = Regex::new(r"\{\{OTRS[^}]+\}\}").map_err(|e| e.to_string())?;
        otrs_orig = pattern
            .find_iter(&text)
            .map(|m| m.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        text = pattern.replace_all(&text, "").into_owned();
    }

    // Original upload history.
    let mut users: Vec<String> = Vec::new();
    let mut rows: BTreeMap<String, String> = BTreeMap::new();
    let mut original_uploader = String::new();
    let mut first_date = String::new();
    let mut last_date = String::new();
    for revision in &source.history {
        let user = revision.user.clone();
        if !users.contains(&user) {
            users.push(user.clone());
        }
        original_uploader = user.clone();
        let user_link = format!("[[:{language2}:User:{user}|{user}]]");
        let date = short_timestamp(&revision.timestamp);
        last_date = date.clone();
        if first_date.is_empty() {
            first_date = date.clone();
        }
        let comment = revision.comment.replace('\n', " ");
        let dimensions = format!(
            "{}&times;{}&times; ({} bytes)",
            revision.width, revision.height, revision.size
        );
        rows.insert(
            revision.timestamp.clone(),
            format!("| {date} || {dimensions} || {user_link} || ''<nowiki>{comment}</nowiki>''"),
        );
    }
    let log_rows: Vec<String> = rows.values().rev().cloned().collect();
    let log = format!(
        "{{| class=\"wikitable filehistory\"\n! {{{{int:filehist-datetime}}}} !! {{{{int:filehist-dimensions}}}} !! \
         {{{{int:filehist-user}}}} !! {{{{int:filehist-comment}}}}\n|-\n{}\n|}}",
        log_rows.join("\n|-\n")
    );

    // Author and source.
    let orig_wiki_link = format!("[https://{language}.{project}.org {language}.{project}]");
    let author_links = format!("{{{{User at project|{original_uploader}|{project}|{language}}}}}");
    let mut author = format!("{{{{Original uploader|{original_uploader}|{project}|{language}}}}}");
    if users.len() > 1 {
        author.push_str(".\nLater version(s) were uploaded by ");
        let later: Vec<String> = users
            .iter()
            .filter(|u| **u != original_uploader)
            .map(|u| format!("[[:{language2}:User:{u}|{u}]]"))
            .collect();
        author.push_str(&later.join(", "));
        author.push_str(&format!(" at {orig_wiki_link}."));
    }
    if language == "nl" {
        text = replace_ci(&text, "{{self|PD-auteur", "{{self|1=PD-self");
    }
    text = replace_ci(
        &text,
        "{{self|",
        &format!("{{{{Self|author={author_links}|"),
    );
    let source_link = format!("{{{{transferred from|{language}.{project}}}}}");
    let orig_desc_link = format!(
        "{{{{original description|{language}.{project}|{}}}}}",
        urlencoding::encode(&image)
    );

    // Date.
    let date = if first_date == last_date {
        let first = first_date.get(..10).unwrap_or(&first_date);
        format!("{{{{Original upload date|{first}}}}}")
    } else {
        let first = first_date.get(..10).unwrap_or(&first_date);
        let last = last_date.get(..10).unwrap_or(&last_date);
        format!("{last} (first version); {first} (last version)")
    };

    // Licensing.
    let mut is_good = false;
    let mut licenses: BTreeMap<String, String> = BTreeMap::new();
    let mut license_params: BTreeMap<String, String> = BTreeMap::new();
    let mut permission: BTreeMap<String, String> = BTreeMap::new();
    let mut self_params: Vec<String> = Vec::new();

    if text.contains("{{Fair use bâtiment récent") {
        return Err("Template prevents transfer to Commons!".to_string());
    }

    let mut templates = source.templates.clone();
    let lower_text = text.to_lowercase();
    for (indicator, template) in &catalog.common.license_indicators {
        if lower_text.contains(indicator.as_str()) {
            templates.push(template.clone());
        }
    }

    // The self/self2 orgy.
    let author_field = Regex::new(r"^\s*(migration|author)\s*=").map_err(|e| e.to_string())?;
    if let Some(found) =
        extract_template(&text, "self").or_else(|| extract_template(&text, "self2"))
    {
        for value in &found.fields {
            let mut value = value.clone();
            let commons_name = catalog.commons_template(language, &value);
            if commons_name != upper_first(&value) && !commons_name.contains('|') {
                value = commons_name;
            }
            if !author_field.is_match(&value) {
                value = upper_first(&value);
            }
            self_params.push(value);
        }
        text = format!("{}{}", found.before, found.after);
        let mut keep = Vec::new();
        for template in templates {
            if catalog.helper.deprecated_licenses.contains(&template) {
                keep.push(template);
            } else if self_params.contains(&template) || template == "Self" || template == "Self2" {
                let lower = template.to_lowercase();
                if let Some(permission_text) = catalog.helper.permission_texts.get(&template) {
                    is_good = true;
                    permission.insert(permission_text.clone(), permission_text.clone());
                } else if catalog.common.good_templates.contains(&lower)
                    || lower.starts_with("cc")
                    || lower.starts_with("pd")
                {
                    let upper = template.to_uppercase();
                    permission.insert(upper.clone(), upper);
                    is_good = true;
                }
            } else {
                keep.push(template);
            }
        }
        templates = keep;
    }

    for original in templates.clone() {
        let template = fix_self_template(
            catalog,
            &catalog.commons_template(language, &original),
            &text,
        );
        if catalog.helper.info_templates.contains(&template)
            || catalog
                .helper
                .info_template_names
                .values()
                .any(|name| name == &template)
        {
            continue;
        }
        let lower = template.to_lowercase();
        let title = format!("Template:{}", upper_first(&template));

        // The parameters as they stood in the original text.
        let pattern = ["\\{\\{", &template_pattern(&original), "\\|([^\\}]*)\\}\\}"].concat();
        let params = Regex::new(&pattern)
            .ok()
            .and_then(|regex| regex.captures(&text))
            .and_then(|captures| captures.get(1))
            .map_or_else(String::new, |m| m.as_str().to_string());
        license_params.insert(title.clone(), params.clone());

        if title.contains('|') {
            let (name, rest) = title.split_once('|').unwrap_or((&title, ""));
            let stitched = format!("{rest}|{params}");
            license_params.insert(name.to_string(), stitched.clone());
            license_params.insert(title.clone(), stitched);
            licenses.insert(name.to_string(), name.to_string());
        } else {
            licenses.insert(title.clone(), title.clone());
        }

        // Remove every occurrence of the local template from the text.
        let pattern = ["\\{\\{", &template_pattern(&original), "[^\\}]*\\}\\}"].concat();
        if let Ok(regex) = RegexBuilder::new(&pattern).case_insensitive(true).build() {
            text = regex.replace_all(&text, "").into_owned();
        }

        let upper = template.to_uppercase();
        if catalog
            .helper
            .deprecated_licenses
            .contains(&upper_first(&template))
            && project == "wikipedia"
        {
            // Deprecated on Wikipedia; do not count it as a free license.
        } else if let Some(permission_text) =
            catalog.helper.permission_texts.get(&upper_first(&template))
        {
            permission.insert(permission_text.clone(), permission_text.clone());
            is_good = true;
        } else if catalog.common.good_templates.contains(&lower)
            || lower.starts_with("cc")
            || lower.starts_with("pd")
        {
            permission.insert(upper.clone(), upper);
            is_good = true;
        }
    }

    // Categories and templates that forbid a transfer.
    for category in &source.categories {
        for prevent in &catalog.helper.prevent_transfer_categories {
            if category.starts_with(prevent) {
                is_good = false;
                warnings.push(format!(
                    "Presence of category \"{category}\" prevents transfer to Commons!"
                ));
                break;
            }
        }
    }
    for template in &templates {
        for prevent in &catalog.helper.prevent_transfer_templates {
            if template.starts_with(prevent) {
                is_good = false;
                warnings.push(format!(
                    "Presence of template \"{template}\" prevents transfer to Commons!"
                ));
                break;
            }
        }
    }

    if let Some(gfdl12) = catalog.helper.permission_texts.get("GFDL 1.2")
        && permission.contains_key(gfdl12)
        && let Some(gfdl) = catalog.helper.permission_texts.get("GFDL")
    {
        permission.remove(gfdl);
    }

    // Templates that only exist locally.
    for ignored in &catalog.helper.ignore_local_templates {
        let local = format!("Template:{}", upper_first(ignored));
        licenses.retain(|_, value| value != &local);
        permission.remove(&ignored.to_uppercase());
    }

    // Which of these license templates exist on Commons?
    let candidates: Vec<String> = licenses.values().cloned().collect();
    let existing = existing_templates(http, &candidates).await;
    let mut licenses2: Vec<String> = candidates
        .into_iter()
        .filter(|title| existing.contains(&normalise_title(title)))
        .collect();
    for license in &mut licenses2 {
        if let Some(params) = license_params.get(license).filter(|p| !p.is_empty()) {
            let params = params.trim_end_matches('|');
            *license = format!("{license}|{params}");
        }
    }

    // Stitch the licenses back together, and drop the parameters of the
    // self templates from the license list.
    let mut combined: BTreeMap<String, String> = BTreeMap::new();
    let mut self_subs: Vec<String> = Vec::new();
    for license in &licenses2 {
        let base = license.split('|').next().unwrap_or(license).to_string();
        licenses.remove(&base);
        let name = license
            .split_once(':')
            .map_or(license.as_str(), |(_, rest)| rest);
        let lower = name.to_lowercase();
        combined.insert(lower.clone(), format!("{{{{{name}}}}}"));
        if lower.starts_with("self|") || lower.starts_with("self2|") {
            let parts: Vec<&str> = name.split('|').collect();
            self_subs.push("lang".to_string());
            if lower.starts_with("self2|") {
                self_subs.push("self".to_string());
            }
            for value in parts.iter().skip(1) {
                self_subs.push(value.to_lowercase());
                self_subs.push(value.split('-').next().unwrap_or(value).to_lowercase());
            }
        }
    }
    if combined.contains_key("cc-by-sa-any") {
        combined.retain(|key, _| !key.starts_with("cc-by-sa") || key == "cc-by-sa-any");
    }
    for sub in &self_subs {
        combined.remove(sub);
    }
    combined.retain(|key, _| key != "self" && key != "self2");

    let mut license = combined.values().cloned().collect::<Vec<_>>().join("\n");
    if !licenses.is_empty() {
        let missing: Vec<&str> = licenses.values().map(String::as_str).collect();
        license.push_str(&format!(
            "\n<!-- Templates \"{}\" were used in the original description page as well , but do not appear to exist on commons. -->",
            missing.join("\", \"")
        ));
    }

    // Language-specific self templates.
    if language == "en" {
        license = license.replace(
            "{{GFDL-self}}",
            &format!("{{{{GFDL-user-en-no-disclaimers|{original_uploader}}}}}"),
        );
    }
    if language == "sr" {
        license = license.replace(
            "{{GFDL-self}}",
            &format!("{{{{GFDL-user-w|sr|Wikipedia|{original_uploader}}}}}"),
        );
        license = replace_regex(
            &license,
            r"\{\{PD-self(\|date=[\w\s]+)?\}\}",
            &format!("{{{{PD-user-w|{language}|{project}|{original_uploader}}}}}"),
        );
    } else {
        license = license.replace(
            "{{GFDL-self}}",
            &format!("{{{{GFDL-user-{language}|{original_uploader}}}}}"),
        );
        license = replace_regex(
            &license,
            r"\{\{PD-self(\|date=[\w\s]+)?\}\}",
            &format!("{{{{PD-user-w|{language}|{project}|{original_uploader}}}}}"),
        );
    }
    for needle in [
        "{{GFDL-with-disclaimers}}",
        "{{GFDL-en}}",
        "{{GFDL-it}}",
        "{{GFDL 1.2}}",
        "{{GFDL-1.2-en}}",
    ] {
        if contains_ci(&license, needle) {
            license = license.replace("{{GFDL}}", "").trim().to_string();
        }
    }
    if contains_ci(&license, "{{GFDL-Utente}}") {
        license = license.trim().replace(
            "{{GFDL-Utente}}",
            &format!("{{{{GFDL-user-it|{original_uploader}}}}}"),
        );
    }
    if contains_ci(&license, "{{GFDL-user-en-no-disclaimers}}") {
        license = license
            .replace("{{GFDL-self-no-disclaimers}}", "")
            .trim()
            .to_string();
    }
    if contains_ci(&license, "{{GFDL-user-en-with-disclaimers}}") {
        license = license.replace("{{GFDL-self-en}}", "").trim().to_string();
    }
    license = license.replace(
        "-disclaimers}}",
        &(format!("-disclaimers|{original_uploader}") + "}}"),
    );

    if !self_params.is_empty() {
        license.push_str(&format!("\n{{{{self|{}}}}}", self_params.join("|")));
    }

    // Pseudo-duplicate licenses such as GFDL and GFDL-self.
    for (keep, drop) in &catalog.helper.license_dupes {
        if !contains_ci(&license, &format!("{{{{{keep}")) {
            continue;
        }
        license = license
            .replace(&format!("{{{{{drop}}}}}"), "")
            .trim()
            .to_string();
        license = license.replace("\n\n", "\n").trim().to_string();
    }

    let mut permission = permission.into_values().collect::<Vec<_>>().join("; ");
    if !permission.is_empty() {
        permission.push('.');
    }

    // Description.
    let mut description = text.trim().to_string();
    loop {
        let before = description.clone();
        if description.starts_with('=') {
            description = description
                .split_once('\n')
                .map_or(String::new(), |(_, rest)| rest.trim().to_string());
            continue;
        }
        let mut lines: Vec<&str> = description.split('\n').collect();
        match lines.pop() {
            Some(last) if !last.starts_with('=') => lines.push(last),
            _ => {}
        }
        description = lines.join("\n").trim().to_string();
        if description == before {
            break;
        }
    }
    if description.starts_with('*') || description.starts_with('#') {
        description.insert(0, '\n');
    }

    if remove_categories {
        if let Some(category) = catalog.helper.category_names.get(language) {
            description = remove_category_links(&description, &language2, category);
        }
        if let Some(category) = catalog.helper.category_names.get("en") {
            description = remove_category_links(&description, &language2, category);
        }
        description = description.trim().to_string();
    }

    if description.starts_with("{{NowCommons") {
        description = description
            .split_once('\n')
            .map_or(String::new(), |(_, rest)| rest.trim().to_string());
    }
    description = description.replace(
        &format!(":{language}:{language}:"),
        &format!(":{language}:"),
    );
    description = description.replace("|\n|", "\n|");

    let mut other_versions = String::new();
    let mut source = source_link;
    let mut date = date;
    if let Some(info_name) = catalog.helper.info_template_names.get(language) {
        let info = format!("{{{{{info_name}");
        let info_pattern = RegexBuilder::new(&regex::escape(&info))
            .case_insensitive(true)
            .build()
            .ok();
        if let Some(found) = info_pattern
            .as_ref()
            .and_then(|regex| regex.find(&description))
        {
            let d2 = format!("{info}{}", &description[found.end()..]);
            let d2 = d2.replace("|\n", "\n|").replace("\n\n", "\n");
            let mut rest_lines: Vec<String> = Vec::new();
            let mut mode_in = true;
            let mut key = String::new();
            let mut cat = String::new();
            let mut data: BTreeMap<String, String> = [
                "Beschreibung",
                "Quelle",
                "Urheber",
                "Datum",
                "Genehmigung",
                "Andere Versionen",
            ]
            .into_iter()
            .map(|k| (k.to_string(), String::new()))
            .collect();
            for line in d2.split('\n') {
                if !mode_in {
                    rest_lines.push(line.to_string());
                    continue;
                }
                let line = line.trim();
                if line == "}}" {
                    map_information_key(catalog, &mut key);
                    if !key.is_empty() && !cat.is_empty() {
                        data.insert(key.clone(), cat.clone());
                    }
                    mode_in = false;
                    continue;
                }
                if !line.starts_with('|') {
                    cat.push('\n');
                    cat.push_str(line);
                    continue;
                }
                map_information_key(catalog, &mut key);
                if !key.is_empty() && !cat.is_empty() {
                    data.insert(key.clone(), cat.clone());
                }
                let (k, v) = line.split_once('=').unwrap_or((line, ""));
                key = k.trim_start_matches('|').trim().to_string();
                cat = v.trim().to_string();
            }
            if !cat.is_empty() {
                data.insert(key.clone(), cat);
            }
            description = rest_lines.join("\n");
            fix_localized_info_table(language, &mut data);
            description = add_original_description(
                &description,
                data.get("Beschreibung").map_or("", |s| s),
                true,
                language,
            );
            source = add_original_description(
                &source,
                data.get("Quelle").map_or("", |s| s),
                false,
                language,
            );
            date = add_original_description2(&date, data.get("Datum").map_or("", |s| s));
            author = format!(
                "{}.\n{author}",
                add_original_description(
                    "",
                    data.get("Urheber").map_or("", |s| s),
                    false,
                    language
                )
            )
            .trim()
            .to_string();
            permission = add_original_description(
                &permission,
                data.get("Genehmigung").map_or("", |s| s),
                false,
                language,
            );
            other_versions = add_original_description(
                &other_versions,
                data.get("Andere Versionen").map_or("", |s| s),
                false,
                language,
            );
        }
    } else if language == "de" {
        // Attempt to parse German free text.
        let (new_description, new_source, new_permission, new_date, new_author) =
            parse_german(&description, &source, &permission, &date, &author);
        description = new_description;
        source = new_source;
        permission = new_permission;
        date = new_date;
        author = new_author;
    }

    // Remove certain headings.
    let mut kept = Vec::new();
    for line in description.split('\n') {
        let heading = line.replace('=', "").trim().to_lowercase();
        if catalog.helper.bad_headings.contains(&heading) {
            continue;
        }
        kept.push(line);
    }
    description = kept.join("\n").trim().to_string();

    // Final fixes.
    if description.is_empty() {
        description = "''no original description''".to_string();
    }
    permission = format!("{permission}\n{}", otrs_data.join("\n"))
        .trim()
        .to_string();
    if permission.is_empty() {
        permission = "''See license section.''".to_string();
    }
    license = license.replace("{{Author}}", "").trim().to_string();
    permission = format!("{permission}\n{otrs_orig}").trim().to_string();

    // Original categories, when they are not removed.
    let mut orig_cats = String::new();
    if !remove_categories {
        if let Some(category) = catalog.helper.category_names.get(language) {
            orig_cats.push_str(&category_links(&description, &language2, category));
        }
        if let Some(category) = catalog.helper.category_names.get("en") {
            orig_cats.push_str(&category_links(&description, &language2, category));
        }
    }

    if let Some(found) = RegexBuilder::new(&regex::escape("{{Nach Commons verschieben (bestätigt)"))
        .case_insensitive(true)
        .build()
        .ok()
        .and_then(|regex| regex.find(&description))
    {
        let after = &description[found.end()..];
        if let Some((_, rest)) = after.split_once("}}") {
            description = format!("{}{}", &description[..found.start()], rest)
                .trim()
                .to_string();
        }
    }

    let mut fin = String::from("__NOTOC__\n");
    if orig_cats.is_empty() {
        fin.push_str("\n{{subst:Unc}} <!-- Remove this line once you have added categories -->");
    } else {
        fin.push('\n');
        fin.push_str(&orig_cats);
    }

    let already_wrapped = description.split('|').next() == Some(format!("{{{{{language}").as_str());
    if !language.is_empty() && !already_wrapped {
        description = format!("{{{{{language}|{description}}}}}");
    }

    license = otrs_pattern.replace_all(&license, "").into_owned();
    license = license.replace("$$UPLOADER$$", &author_links);

    let mut out = format!(
        "\n== {{{{int:filedesc}}}} ==\n{{{{Information\n|Description={description}\n|Source={source}\n|Date={date}\n\
         |Author={author}\n|Permission={permission}\n|other_versions={other_versions}\n}}}}\n\n\
         == {{{{int:license-header}}}} ==\n{license}\n\n== {{{{Original upload log}}}} ==\n{orig_desc_link}\n{log}\n{fin}"
    );

    // Remove categories Commons does not want.
    for category in ["Hidden categories", "Stub icons"] {
        out = replace_ci(&out, &format!("[[Category:{category}]]"), "");
        out = replace_ci(
            &out,
            &format!("[[Category:{}]]", category.replace(' ', "_")),
            "",
        );
    }
    out = replace_ci(&out, "{{PD}}", "");
    out = out.replace("|Migration=relicense", "|migration=relicense");
    out = replace_regex(
        &out,
        &format!(r"\[\[(:{}:[^|\]]+)\]\]", regex::escape(&language2)),
        "[[$1|]]",
    );
    out = replace_ci(&out, "[[:wikiversity:beta:", "[[:betawikiversity:");
    if !otrs_orig.is_empty() {
        out = out.replace("{{OTRS}}", "");
    }
    out = out.replace("Http://", "http://");
    out = out.replace('\t', "");

    Ok(UploadText {
        text: out,
        is_good,
        warnings,
    })
}

fn short_timestamp(timestamp: &str) -> String {
    let mut parts: Vec<&str> = timestamp.split(':').collect();
    parts.pop();
    parts
        .join(":")
        .replace('T', " ")
        .replace('z', "")
        .trim()
        .to_string()
}

fn remove_image_namespace(catalog: &Catalog, image: &str) -> String {
    let lower = image.to_lowercase();
    // `File:` is not in the PHP alias list, but accepting it prevents a
    // duplicated namespace ("File:File:…") when users paste a full title.
    if lower.starts_with("file:") {
        return image
            .split_once(':')
            .map_or_else(|| image.to_string(), |(_, rest)| rest.to_string());
    }
    for alias in &catalog.common.image_aliases {
        if lower.starts_with(alias) {
            return image
                .split_once(':')
                .map_or_else(|| image.to_string(), |(_, rest)| rest.to_string());
        }
    }
    image.to_string()
}

fn fix_self_template(catalog: &Catalog, template: &str, text: &str) -> String {
    let lower = template.to_lowercase();
    if lower != "pd" && lower != "gfdl" {
        return template.to_string();
    }
    let text = text.to_lowercase().replace(' ', "");
    if catalog
        .helper
        .self_texts
        .iter()
        .any(|needle| text.contains(needle))
    {
        format!("{template}-self")
    } else {
        template.to_string()
    }
}

fn map_information_key(catalog: &Catalog, key: &mut String) {
    let lower = key.to_lowercase();
    if let Some(mapped) = catalog.helper.information_keys.get(&lower) {
        *key = upper_first(mapped);
    }
}

fn fix_localized_info_table(language: &str, data: &mut BTreeMap<String, String>) {
    if language != "fi" {
        return;
    }
    let mapping = [
        ("Kuvaus", "Beschreibung"),
        ("Lähde", "Quelle"),
        ("Päiväys", "Datum"),
        ("Tekijänoikeuksien haltija", "Urheber"),
    ];
    for (from, to) in mapping {
        if data.get(to).is_some_and(|value| !value.is_empty()) {
            continue;
        }
        let mut lower = from.chars();
        let lower_first: String = lower.next().map_or_else(String::new, |first| {
            first.to_lowercase().chain(lower).collect()
        });
        if let Some(value) = data.get(&upper_first(from)).cloned() {
            data.insert(to.to_string(), value);
        }
        if let Some(value) = data.get(&lower_first).cloned() {
            data.insert(to.to_string(), value);
        }
    }
}

fn add_original_description(desc: &str, orig: &str, translate: bool, language: &str) -> String {
    let orig = orig.trim();
    if orig.is_empty() {
        return desc.to_string();
    }
    let desc = desc.trim();
    if desc.is_empty() {
        return orig.to_string();
    }
    if translate {
        return format!("{{{{{language}|{orig}<br/>\n{desc}}}}}");
    }
    format!("{desc}<br/>\n(Original text : ''{orig}'')")
}

fn add_original_description2(desc: &str, orig: &str) -> String {
    let orig = orig.trim();
    if orig.is_empty() {
        return desc.to_string();
    }
    let desc = desc.trim();
    if desc.is_empty() {
        return orig.to_string();
    }
    format!("{orig}<br/>\n({desc})")
}

fn add_br(first: &str, second: &str) -> String {
    match (first.trim(), second.trim()) {
        ("", second) => second.to_string(),
        (first, "") => first.to_string(),
        (first, second) => format!("{first}<br/>\n{second}"),
    }
}

fn parse_german(
    description: &str,
    source: &str,
    permission: &str,
    date: &str,
    author: &str,
) -> (String, String, String, String, String) {
    let beginnings = ['*', '\'', ' '];
    let continuations = ['\'', ':', ' '];
    let mut description_out = String::new();
    let mut source = source.to_string();
    let mut permission = permission.to_string();
    let mut date = date.to_string();
    let mut author = author.to_string();

    for original in description.split('\n') {
        let mut line = original;
        let mut key = String::new();
        while line.starts_with(|c| beginnings.contains(&c)) {
            line = &line[1..];
        }
        while let Some(c) = line.chars().next() {
            if c.is_ascii_alphabetic() || c == '/' {
                key.push(c);
                line = &line[c.len_utf8()..];
            } else {
                break;
            }
        }
        while line.starts_with(|c| continuations.contains(&c)) {
            line = &line[1..];
        }
        let key = key.to_uppercase();
        let line = upper_first(line.trim());
        match key.as_str() {
            "QUELLE" => source = add_original_description(&source, &line, false, ""),
            "LIZENZSTATUS" | "LIZENZ" => {
                permission = add_original_description(&permission, &line, false, "")
            }
            "DATUM" => date = add_br(&line, &date),
            "FOTOGRAF" | "ZEICHNER" | "FOTOGRAF/ZEICHNER" => author = add_br(&line, &author),
            "BESCHREIBUNG" | "BILDBESCHREIBUNG" => {
                description_out = format!(
                    "{}\n",
                    add_original_description(&description_out, &line, false, "")
                );
            }
            _ => {
                description_out.push_str(original);
                description_out.push('\n');
            }
        }
    }
    (
        description_out.trim().to_string(),
        source,
        permission,
        date,
        author,
    )
}

fn remove_category_links(text: &str, language2: &str, category: &str) -> String {
    let pattern = format!(r"\[\[:{}:{category}:.*?]]", regex::escape(language2));
    match RegexBuilder::new(&pattern).case_insensitive(true).build() {
        Ok(regex) => regex.replace_all(text, "").into_owned(),
        Err(_) => text.to_string(),
    }
}

fn category_links(text: &str, language2: &str, category: &str) -> String {
    let pattern = format!(r"\[\[:{}:({category}:.*?)]]", regex::escape(language2));
    let Ok(regex) = RegexBuilder::new(&pattern).case_insensitive(true).build() else {
        return String::new();
    };
    let mut out = String::new();
    for captures in regex.captures_iter(text) {
        if let Some(found) = captures.get(1) {
            out.push_str(&format!("[[{}]]\n", found.as_str()));
        }
    }
    out
}

async fn existing_templates(http: &reqwest::Client, titles: &[String]) -> HashSet<String> {
    let mut existing = HashSet::new();
    let unique: BTreeSet<&String> = titles.iter().collect();
    let titles: Vec<&String> = unique.into_iter().collect();
    for chunk in titles.chunks(50) {
        let joined = chunk
            .iter()
            .map(|t| t.as_str())
            .collect::<Vec<_>>()
            .join("|");
        let params = [("action", "query"), ("titles", joined.as_str())];
        match wiki_api::api_post(http, &Wiki::commons(), &params).await {
            Ok(answer) => {
                for page in answer["query"]["pages"].as_array().into_iter().flatten() {
                    if page.get("missing").is_none()
                        && let Some(title) = page["title"].as_str()
                    {
                        existing.insert(normalise_title(title));
                    }
                }
            }
            Err(e) => tracing::warn!("checking license templates on Commons failed: {e}"),
        }
    }
    existing
}

fn normalise_title(title: &str) -> String {
    let spaced = title.replace('_', " ");
    match spaced.split_once(':') {
        Some((namespace, rest)) => format!("{namespace}:{}", upper_first(rest)),
        None => upper_first(&spaced),
    }
}

/// `{{name…}}`, with its top-level fields, and the text around it.
struct Template {
    before: String,
    after: String,
    fields: Vec<String>,
}

fn extract_template(text: &str, name: &str) -> Option<Template> {
    // Find the opening braces in the original text: lower-casing can change
    // byte lengths, so an index from a lower-cased copy may not be a char
    // boundary here.
    let pattern = ["\\{\\{", &regex::escape(name)].concat();
    let opening = RegexBuilder::new(&pattern)
        .case_insensitive(true)
        .build()
        .ok()?;
    let found = opening.find(text)?;
    let start = found.start();
    let after_name = found.end();
    let next = text[after_name..].chars().next()?;
    if next != '|' && next != '}' {
        return None;
    }
    let mut depth = 1usize;
    let mut index = after_name;
    let bytes = text.as_bytes();
    let end;
    loop {
        if index + 1 >= bytes.len() {
            return None;
        }
        match &bytes[index..index + 2] {
            b"{{" => {
                depth += 1;
                index += 2;
            }
            b"}}" => {
                depth -= 1;
                index += 2;
                if depth == 0 {
                    end = index;
                    break;
                }
            }
            _ => index += 1,
        }
    }
    let body = &text[start + 2..end - 2];
    let fields = split_top_level(body).into_iter().skip(1).collect();
    Some(Template {
        before: text[..start].to_string(),
        after: text[end..].to_string(),
        fields,
    })
}

fn split_top_level(body: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut depth = 0usize;
    let mut current = String::new();
    let mut chars = body.char_indices().peekable();
    while let Some((_, c)) = chars.next() {
        match c {
            '{' if chars.peek().is_some_and(|(_, next)| *next == '{') => {
                chars.next();
                depth += 1;
                current.push_str("{{");
            }
            '}' if chars.peek().is_some_and(|(_, next)| *next == '}') => {
                chars.next();
                depth = depth.saturating_sub(1);
                current.push_str("}}");
            }
            '|' if depth == 0 => parts.push(std::mem::take(&mut current)),
            c => current.push(c),
        }
    }
    parts.push(current);
    parts
}

fn template_pattern(template: &str) -> String {
    let mut pattern = String::new();
    for c in template.chars() {
        match c {
            '_' | ' ' => pattern.push_str("[ _]"),
            c if "\\^$.|?*+()[]{}".contains(c) => {
                pattern.push('\\');
                pattern.push(c);
            }
            c => pattern.push(c),
        }
    }
    pattern
}

fn contains_ci(haystack: &str, needle: &str) -> bool {
    haystack.to_lowercase().contains(&needle.to_lowercase())
}

fn replace_ci(text: &str, needle: &str, replacement: &str) -> String {
    let Ok(regex) = RegexBuilder::new(&regex::escape(needle))
        .case_insensitive(true)
        .build()
    else {
        return text.to_string();
    };
    regex.replace_all(text, NoExpand(replacement)).into_owned()
}

fn replace_regex(text: &str, pattern: &str, replacement: &str) -> String {
    let Ok(regex) = Regex::new(pattern) else {
        return text.to_string();
    };
    regex.replace_all(text, replacement).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamps_lose_the_seconds() {
        assert_eq!(short_timestamp("2020-01-02T03:04:05Z"), "2020-01-02 03:04");
        assert_eq!(short_timestamp("2020-01-02T03:04:05"), "2020-01-02 03:04");
    }

    #[test]
    fn extracts_a_template_with_nested_fields() {
        let found = extract_template("before {{Self|GFDL|{{other|x}}}} after", "self").unwrap();
        assert_eq!(found.fields, ["GFDL", "{{other|x}}"]);
        assert_eq!(found.before, "before ");
        assert_eq!(found.after, " after");
        assert!(extract_template("{{selfish}}", "self").is_none());
        assert!(extract_template("no template", "self").is_none());
    }

    #[test]
    fn template_patterns_accept_spaces_and_underscores() {
        assert_eq!(template_pattern("Bild-CC-by-sa/2.0"), "Bild-CC-by-sa/2\\.0");
        assert_eq!(template_pattern("a b_c"), "a[ _]b[ _]c");
    }

    #[test]
    fn descriptions_are_combined_like_php() {
        assert_eq!(add_original_description("", "orig", false, "de"), "orig");
        assert_eq!(add_original_description("desc", "", false, "de"), "desc");
        assert_eq!(
            add_original_description("desc", "orig", false, "de"),
            "desc<br/>\n(Original text : ''orig'')"
        );
        assert_eq!(
            add_original_description("desc", "orig", true, "de"),
            "{{de|orig<br/>\ndesc}}"
        );
        assert_eq!(
            add_original_description2("desc", "orig"),
            "orig<br/>\n(desc)"
        );
        assert_eq!(add_br("a", "b"), "a<br/>\nb");
        assert_eq!(add_br("", "b"), "b");
    }

    #[test]
    fn titles_are_normalised_for_comparison() {
        assert_eq!(normalise_title("Template:pd-self"), "Template:Pd-self");
        assert_eq!(normalise_title("pd_self"), "Pd self");
    }

    #[test]
    fn image_namespaces_are_stripped_in_every_alias() {
        let catalog = Catalog::load().unwrap();
        for (input, expected) in [
            ("Image:X.jpg", "X.jpg"),
            ("Bild:Y.jpg", "Y.jpg"),
            ("File:Z.jpg", "Z.jpg"),
            ("plain.jpg", "plain.jpg"),
        ] {
            assert_eq!(remove_image_namespace(&catalog, input), expected, "{input}");
        }
    }

    #[test]
    fn german_free_text_is_parsed() {
        let (description, source, _, _, _) = parse_german(
            "Beschreibung: Ein Haus\nQuelle: Eigenes Foto\nSonstiges",
            "",
            "",
            "",
            "",
        );
        assert!(description.contains("Ein Haus"));
        assert!(description.contains("Sonstiges"));
        assert_eq!(source, "Eigenes Foto");
    }
}
