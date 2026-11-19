// Rebuild when the embedded front-end or data files change: `include_dir!`
// notices new files only after a rebuild.
fn main() {
    println!("cargo:rerun-if-changed=assets");
    println!("cargo:rerun-if-changed=data");
}
