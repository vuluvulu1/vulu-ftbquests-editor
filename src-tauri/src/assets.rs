//! Item icon sources: finds an instance's vanilla jar, mod jars, kubejs assets and
//! enabled resource packs, and serves byte ranges of them to the frontend, which
//! parses the zips itself (src/core/assets). Mirrors src/platform/nodeAssets.ts.
//! Only paths handed out by `instance_assets` may be read.

use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tauri::ipc::Response;

#[derive(Default)]
pub struct AllowedSources(Mutex<HashSet<PathBuf>>);

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SourceSpec {
    Zip { id: String, name: String, size: u64 },
    Dir { id: String, name: String, files: Vec<String> },
}

#[derive(Serialize)]
pub struct InstanceAssetInfo {
    version: Option<String>,
    vanilla: bool,
    sources: Vec<SourceSpec>,
}

fn read_json(path: &Path) -> Option<serde_json::Value> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

/// Minecraft version (and CurseForge's original install path) from instance metadata.
fn detect_version(instance: &Path) -> (Option<String>, Option<PathBuf>) {
    if let Some(cf) = read_json(&instance.join("minecraftinstance.json")) {
        if let Some(v) = cf["gameVersion"].as_str() {
            return (Some(v.to_string()), cf["installPath"].as_str().map(PathBuf::from));
        }
    }
    if let Some(m) = read_json(&instance.join("manifest.json")) {
        if let Some(v) = m["minecraft"]["version"].as_str() {
            return (Some(v.to_string()), None);
        }
    }
    for mmc in [instance.join("..").join("mmc-pack.json"), instance.join("mmc-pack.json")] {
        if let Some(pack) = read_json(&mmc) {
            let version = pack["components"]
                .as_array()
                .and_then(|c| c.iter().find(|c| c["uid"] == "net.minecraft"))
                .and_then(|c| c["version"].as_str());
            if let Some(v) = version {
                return (Some(v.to_string()), None);
            }
        }
    }
    (None, None)
}

fn vanilla_candidates(instance: &Path, version: &str, install_path: Option<&Path>) -> Vec<PathBuf> {
    let client = format!("minecraft-{version}-client.jar");
    let jar = format!("{version}.jar");
    let mut out = Vec::new();
    for base in std::iter::once(instance).chain(install_path) {
        out.push(base.join("../../Install/versions").join(version).join(&jar)); // CurseForge
        out.push(base.join("../../libraries/com/mojang/minecraft").join(version).join(&client)); // Prism / MultiMC
        out.push(base.join("../../../libraries/com/mojang/minecraft").join(version).join(&client));
    }
    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        out.push(Path::new(&home).join("curseforge/minecraft/Install/versions").join(version).join(&jar));
    }
    if let Ok(app_data) = std::env::var("APPDATA") {
        out.push(Path::new(&app_data).join(".minecraft/versions").join(version).join(&jar));
        out.push(Path::new(&app_data).join("PrismLauncher/libraries/com/mojang/minecraft").join(version).join(&client));
    }
    out
}

fn list_files(dir: &Path, prefix: &str, out: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            list_files(&entry.path(), &format!("{prefix}{name}/"), out);
        } else {
            out.push(format!("{prefix}{name}"));
        }
    }
}

fn file_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

fn zip_spec(path: &Path) -> Option<SourceSpec> {
    let size = fs::metadata(path).ok()?.len();
    Some(SourceSpec::Zip { id: path.to_string_lossy().into_owned(), name: file_name(path), size })
}

fn dir_spec(root: &Path, name: String) -> Option<SourceSpec> {
    if !root.join("assets").is_dir() {
        return None;
    }
    let mut files = Vec::new();
    list_files(&root.join("assets"), "assets/", &mut files);
    Some(SourceSpec::Dir { id: root.to_string_lossy().into_owned(), name, files })
}

/// `resourcePacks:["vanilla","file/foo.zip"]` from options.txt, lowest priority first.
fn enabled_resource_packs(instance: &Path) -> Vec<PathBuf> {
    let Ok(options) = fs::read_to_string(instance.join("options.txt")) else { return vec![] };
    let Some(line) = options.lines().find(|l| l.starts_with("resourcePacks:")) else { return vec![] };
    let packs: Vec<String> = serde_json::from_str(&line["resourcePacks:".len()..]).unwrap_or_default();
    packs
        .iter()
        .filter_map(|p| p.strip_prefix("file/"))
        .map(|p| instance.join("resourcepacks").join(p))
        .collect()
}

/// `root` is `<instance>/config/ftbquests/quests`.
#[tauri::command]
pub fn instance_assets(root: String, allowed: tauri::State<AllowedSources>) -> Result<Option<InstanceAssetInfo>, String> {
    // Not canonicalize(): on Windows it returns \\?\ paths, where the "../.." of the candidates is not resolved.
    let Some(instance) = Path::new(&root).ancestors().nth(3).map(Path::to_path_buf) else { return Ok(None) };
    let mods = instance.join("mods");
    if !mods.is_dir() {
        return Ok(None);
    }
    let (version, install_path) = detect_version(&instance);
    let vanilla = version
        .as_deref()
        .and_then(|v| vanilla_candidates(&instance, v, install_path.as_deref()).into_iter().find(|p| p.is_file()));

    let mut sources = Vec::new();
    sources.extend(vanilla.as_deref().and_then(zip_spec));
    let mut jars: Vec<PathBuf> = fs::read_dir(&mods)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "jar"))
        .collect();
    jars.sort();
    sources.extend(jars.iter().filter_map(|p| zip_spec(p)));
    sources.extend(dir_spec(&instance.join("kubejs"), "kubejs".into()));
    for pack in enabled_resource_packs(&instance) {
        let spec = if pack.is_dir() { dir_spec(&pack, file_name(&pack)) } else { zip_spec(&pack) };
        sources.extend(spec);
    }

    let mut set = allowed.0.lock().map_err(|e| e.to_string())?;
    for s in &sources {
        let (SourceSpec::Zip { id, .. } | SourceSpec::Dir { id, .. }) = s;
        set.insert(PathBuf::from(id));
    }
    Ok(Some(InstanceAssetInfo { version, vanilla: vanilla.is_some(), sources }))
}

fn check_allowed(allowed: &AllowedSources, id: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(id);
    if allowed.0.lock().map_err(|e| e.to_string())?.contains(&path) {
        Ok(path)
    } else {
        Err(format!("İzin verilmeyen kaynak: {id}"))
    }
}

/// Raw bytes of a zip range; returned as binary (ArrayBuffer) rather than JSON.
#[tauri::command]
pub fn read_range(id: String, offset: u64, length: u64, allowed: tauri::State<AllowedSources>) -> Result<Response, String> {
    let path = check_allowed(&allowed, &id)?;
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    let mut buffer = Vec::with_capacity(length as usize);
    file.take(length).read_to_end(&mut buffer).map_err(|e| e.to_string())?;
    Ok(Response::new(buffer))
}

/// A file inside an allowed folder source (kubejs, resource pack folders).
#[tauri::command]
pub fn read_asset_file(id: String, path: String, allowed: tauri::State<AllowedSources>) -> Result<Response, String> {
    let root = check_allowed(&allowed, &id)?;
    if Path::new(&path).components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(format!("Geçersiz yol: {path}"));
    }
    fs::read(root.join(path)).map(Response::new).map_err(|e| e.to_string())
}
