//! The CommonsHelper dictionaries, extracted from the PHP tool's
//! `common_data.php`, `transwiki_data.php`, and `index.php`.
//!
//! The files live in `data/` and are compiled into the binary, so deployment
//! cannot forget them. They are parsed once at start-up; a broken data file
//! stops the service instead of failing per request.

use anyhow::{Context, Result};
use serde::Deserialize;
use std::collections::{BTreeMap, HashMap};

/// `data/common.json`: the broad dictionaries from `common_data.php`.
#[derive(Debug, Deserialize)]
pub struct Common {
    pub license_indicators: BTreeMap<String, String>,
    pub image_aliases: Vec<String>,
    pub good_templates: Vec<String>,
}

/// `data/commonshelper.json`: the dictionaries the text builder needs.
#[derive(Debug, Deserialize)]
pub struct Helper {
    pub permission_texts: BTreeMap<String, String>,
    pub information_keys: BTreeMap<String, String>,
    pub info_templates: Vec<String>,
    pub info_template_names: BTreeMap<String, String>,
    pub category_names: BTreeMap<String, String>,
    pub bad_headings: Vec<String>,
    pub license_dupes: BTreeMap<String, String>,
    pub deprecated_licenses: Vec<String>,
    pub prevent_transfer_categories: Vec<String>,
    pub prevent_transfer_templates: Vec<String>,
    pub self_texts: Vec<String>,
    pub ignore_local_templates: Vec<String>,
}

/// `data/transwiki.json`: local template => Commons template, per language.
#[derive(Debug, Deserialize)]
#[serde(transparent)]
pub struct Transwiki(pub HashMap<String, HashMap<String, String>>);

#[derive(Debug)]
pub struct Catalog {
    pub common: Common,
    pub helper: Helper,
    pub transwiki: Transwiki,
}

impl Catalog {
    pub fn load() -> Result<Self> {
        Ok(Self {
            common: parse(include_str!("../../data/common.json"), "common.json")?,
            helper: parse(
                include_str!("../../data/commonshelper.json"),
                "commonshelper.json",
            )?,
            transwiki: parse(include_str!("../../data/transwiki.json"), "transwiki.json")?,
        })
    }

    /// The Commons name for a local template. This is `get_commons_template`
    /// from the PHP tool: try the lower-case first letter, then the upper-case
    /// one, and otherwise return the name with an upper-case first letter.
    pub fn commons_template(&self, language: &str, template: &str) -> String {
        let mut chars = template.chars();
        let lower = chars.next().map_or_else(String::new, |first| {
            first.to_lowercase().chain(chars).collect()
        });
        if let Some(name) = self.transwiki.0.get(language).and_then(|t| t.get(&lower)) {
            return name.clone();
        }
        let upper = upper_first(&lower);
        if let Some(name) = self.transwiki.0.get(language).and_then(|t| t.get(&upper)) {
            return name.clone();
        }
        upper
    }
}

fn parse<T: for<'de> Deserialize<'de>>(json: &str, name: &str) -> Result<T> {
    serde_json::from_str(json).with_context(|| format!("invalid data file {name}"))
}

/// `s` with its first character in upper case.
pub fn upper_first(text: &str) -> String {
    let mut chars = text.chars();
    chars.next().map_or_else(String::new, |first| {
        first.to_uppercase().chain(chars).collect()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_data_files_load_and_are_consistent() {
        let catalog = Catalog::load().unwrap();
        assert_eq!(
            catalog.helper.info_templates,
            ["Information", "Tiedoston tiedot"]
        );
        assert!(catalog.common.image_aliases.contains(&"bild:".to_string()));
        assert!(catalog.helper.permission_texts.contains_key("GFDL"));
        assert!(catalog.transwiki.0["de"].contains_key("bild-CC-by-sa/3.0"));
    }

    #[test]
    fn template_mapping_tries_both_letter_cases() {
        let catalog = Catalog::load().unwrap();
        assert_eq!(catalog.commons_template("de", "bild-GFDL"), "GFDL");
        assert_eq!(catalog.commons_template("de", "Bild-GFDL"), "GFDL");
        assert_eq!(catalog.commons_template("en", "pd-self"), "Pd-self");
        assert_eq!(catalog.commons_template("xx", "something"), "Something");
    }

    #[test]
    fn upper_first_handles_unicode() {
        assert_eq!(upper_first("ä.jpg"), "Ä.jpg");
        assert_eq!(upper_first(""), "");
    }
}
