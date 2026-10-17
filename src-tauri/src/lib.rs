//! File access for the editor. Every command works relative to a quests root
//! (a folder containing `data.snbt`) and refuses paths that would escape it.

mod assets;

use std::fs;
use std::path::{Component, Path, PathBuf};

const MAX_BACKUPS: usize = 20;

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Checks that `root` really is a quests folder, so a bad call cannot touch arbitrary directories.
fn quests_root(root: &str) -> CmdResult<PathBuf> {
    let root = PathBuf::from(root);
    if root.join("data.snbt").is_file() {
        Ok(root)
    } else {
        Err(format!("Geçerli bir quests klasörü değil: {}", root.display()))
    }
}

/// Joins a relative "a/b.snbt" path onto the root, rejecting `..`, absolute paths and drive prefixes.
fn resolve(root: &str, rel: &str) -> CmdResult<PathBuf> {
    let rel_path = Path::new(rel);
    if rel.is_empty() || rel_path.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(format!("Geçersiz yol: {rel}"));
    }
    Ok(quests_root(root)?.join(rel_path))
}

/// Finds `<instance>/config/ftbquests/quests` from the instance folder, or from a folder inside
/// it (config, ftbquests, quests) by walking up, so mods are always reachable for icons.
#[tauri::command]
fn resolve_root(path: String) -> CmdResult<String> {
    let picked = PathBuf::from(path);
    for instance in picked.ancestors().take(4) {
        let quests = instance.join("config").join("ftbquests").join("quests");
        if quests.join("data.snbt").is_file() {
            return Ok(quests.to_string_lossy().into_owned());
        }
    }
    // A quests folder outside any instance still opens, just without icons.
    if picked.join("data.snbt").is_file() {
        return Ok(picked.to_string_lossy().into_owned());
    }
    Err("Bu klasörde FTB Quests bulunamadı. Mod paketinin instance klasörünü seçin (içinde mods ve config klasörleri olan).".into())
}

fn walk(dir: &Path, prefix: &str, out: &mut Vec<String>) -> std::io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.file_type()?.is_dir() {
            walk(&entry.path(), &format!("{prefix}{name}/"), out)?;
        } else {
            out.push(format!("{prefix}{name}"));
        }
    }
    Ok(())
}

#[tauri::command]
fn list_files(root: String) -> CmdResult<Vec<String>> {
    let mut out = Vec::new();
    walk(&quests_root(&root)?, "", &mut out).map_err(err)?;
    Ok(out)
}

#[tauri::command]
fn read_file(root: String, path: String) -> CmdResult<String> {
    fs::read_to_string(resolve(&root, &path)?).map_err(|e| format!("{path}: {e}"))
}

/// Writes through a temporary file and renames it, so a crash never leaves a half-written file.
#[tauri::command]
fn write_file(root: String, path: String, content: String) -> CmdResult<()> {
    let target = resolve(&root, &path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    let tmp = target.with_extension("snbt.tmp");
    fs::write(&tmp, content).map_err(|e| format!("{path}: {e}"))?;
    fs::rename(&tmp, &target).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn remove_file(root: String, path: String) -> CmdResult<()> {
    let target = resolve(&root, &path)?;
    if target.exists() {
        fs::remove_file(&target).map_err(|e| format!("{path}: {e}"))?;
    }
    Ok(())
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let dest = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &dest)?;
        } else {
            fs::copy(entry.path(), dest)?;
        }
    }
    Ok(())
}

/// `<instance>/<rel>` for the instance files the editor may touch: KubeJS lang files.
fn instance_file(root: &str, rel: &str) -> CmdResult<PathBuf> {
    let rel_path = Path::new(rel);
    let parts: Vec<_> = rel_path.components().collect();
    let valid = parts.iter().all(|c| matches!(c, Component::Normal(_)))
        && parts.len() == 5 // kubejs/assets/<ns>/lang/<locale>.json
        && rel.starts_with("kubejs/assets/")
        && parts[3].as_os_str() == "lang"
        && rel.ends_with(".json");
    if !valid {
        return Err(format!("Bu dosya düzenlenemez: {rel}"));
    }
    let instance = quests_root(root)?.ancestors().nth(3).map(Path::to_path_buf).ok_or("Instance klasörü bulunamadı")?;
    Ok(instance.join(rel_path))
}

/// `<instance>/<rel>` for a texture the editor adds: `kubejs/assets/<ns>/textures/**.png`.
fn instance_texture(root: &str, rel: &str) -> CmdResult<PathBuf> {
    let rel_path = Path::new(rel);
    let parts: Vec<_> = rel_path.components().collect();
    let lowercase = rel.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "_-./".contains(c));
    let valid = parts.iter().all(|c| matches!(c, Component::Normal(_)))
        && parts.len() >= 5
        && rel.starts_with("kubejs/assets/")
        && parts[3].as_os_str() == "textures"
        && rel.ends_with(".png")
        && lowercase;
    if !valid {
        return Err(format!("Bu dosya yazılamaz: {rel}"));
    }
    let instance = quests_root(root)?.ancestors().nth(3).map(Path::to_path_buf).ok_or("Instance klasörü bulunamadı")?;
    Ok(instance.join(rel_path))
}

#[tauri::command]
fn write_instance_binary(root: String, path: String, content: Vec<u8>) -> CmdResult<()> {
    let target = instance_texture(&root, &path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    let tmp = target.with_extension("png.tmp");
    fs::write(&tmp, content).map_err(|e| format!("{path}: {e}"))?;
    fs::rename(&tmp, &target).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn read_instance_file(root: String, path: String) -> CmdResult<Option<String>> {
    let file = instance_file(&root, &path)?;
    if !file.is_file() {
        return Ok(None);
    }
    fs::read_to_string(file).map(Some).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn write_instance_file(root: String, path: String, content: String) -> CmdResult<()> {
    let target = instance_file(&root, &path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    let tmp = target.with_extension("json.tmp");
    fs::write(&tmp, content).map_err(|e| format!("{path}: {e}"))?;
    fs::rename(&tmp, &target).map_err(|e| format!("{path}: {e}"))
}

/// Copies the quests folder (and `instance_files` about to change, under `instance/`) to
/// `<ftbquests>/editor-backups/quests-<timestamp>`, keeping the newest backups only.
#[tauri::command]
fn backup(root: String, instance_files: Option<Vec<String>>) -> CmdResult<String> {
    let extra: Vec<(String, PathBuf)> = instance_files
        .unwrap_or_default()
        .into_iter()
        .map(|rel| instance_file(&root, &rel).map(|p| (rel, p)))
        .collect::<CmdResult<_>>()?;
    let root = quests_root(&root)?;
    let parent = root.parent().ok_or("Quests klasörünün üst klasörü yok")?;
    let backups = parent.join("editor-backups");
    let name = format!("quests-{}", chrono::Local::now().format("%Y%m%d-%H%M%S"));
    let target = backups.join(&name);
    copy_dir(&root, &target).map_err(err)?;
    for (rel, source) in extra.iter().filter(|(_, p)| p.is_file()) {
        let dest = target.join("instance").join(rel);
        if let Some(dir) = dest.parent() {
            fs::create_dir_all(dir).map_err(err)?;
        }
        fs::copy(source, dest).map_err(err)?;
    }

    let mut existing: Vec<PathBuf> = fs::read_dir(&backups)
        .map_err(err)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.is_dir() && p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("quests-")))
        .collect();
    existing.sort();
    while existing.len() > MAX_BACKUPS {
        let _ = fs::remove_dir_all(existing.remove(0));
    }
    Ok(target.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(assets::AllowedSources::default())
        .invoke_handler(tauri::generate_handler![
            resolve_root,
            list_files,
            read_file,
            write_file,
            remove_file,
            backup,
            read_instance_file,
            write_instance_file,
            write_instance_binary,
            assets::instance_assets,
            assets::read_range,
            assets::read_asset_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
