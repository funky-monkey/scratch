//! Command-line note management: `scratch list|show|new|edit|rm|search`.
//!
//! Runs before the GUI starts and works directly on the files in the notes
//! folder. A running app picks the changes up through its file watcher.

use super::{
    abs_path_from_id, extract_title, get_effective_ignored_dirs, id_from_abs_path,
    is_agent_doc_id, is_visible_notes_entry, load_settings, sanitize_filename,
};
use std::io::{IsTerminal, Read, Write};
use std::path::{Path, PathBuf};

const COMMANDS: &[&str] = &[
    "list", "ls", "show", "cat", "new", "edit", "rm", "search", "help", "--help", "-h",
];

const HELP: &str = "\
Usage: scratch <command> [options]

  scratch                      Open Scratch Plus
  scratch <file.md|folder>     Open a note, or switch the notes folder

  list [--folder F] [--json]   List notes, newest first
  show <note>                  Print a note
  new [title] [--folder F]     Create a note; reads the body from stdin if piped
      [--open]                 ...and open it in the app
  edit <note> [--append]       Replace (or append to) a note with stdin;
                               without stdin, opens it in $EDITOR
  rm <note> [-f]               Delete a note (asks first unless -f)
  search <text> [--json]       Find notes whose title or text contains <text>

<note> is a note ID (folder/name), a path to the .md file, or a unique title.
The notes folder comes from --dir, $SCRATCH_NOTES_DIR, or the app's settings.
";

/// Returns an exit code when the arguments are a CLI command, None to start the GUI.
pub fn try_run() -> Option<i32> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let first = args.first()?;
    if !COMMANDS.contains(&first.as_str()) {
        return None;
    }
    Some(match run(&args) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("scratch: {}", e);
            1
        }
    })
}

struct Opts {
    positional: Vec<String>,
    flags: Vec<String>,
    folder: Option<String>,
    dir: Option<String>,
}

fn parse(args: &[String]) -> Result<Opts, String> {
    let mut o = Opts { positional: vec![], flags: vec![], folder: None, dir: None };
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--folder" => o.folder = Some(it.next().ok_or("--folder needs a value")?.clone()),
            "--dir" => o.dir = Some(it.next().ok_or("--dir needs a value")?.clone()),
            f if f.starts_with('-') && f.len() > 1 => o.flags.push(f.to_string()),
            _ => o.positional.push(a.clone()),
        }
    }
    Ok(o)
}

fn run(args: &[String]) -> Result<(), String> {
    let cmd = args[0].as_str();
    if matches!(cmd, "help" | "--help" | "-h") {
        print!("{}", HELP);
        return Ok(());
    }
    let o = parse(&args[1..])?;
    let root = notes_root(o.dir.as_deref())?;
    let has = |f: &str| o.flags.iter().any(|x| x == f);

    match cmd {
        "list" | "ls" => {
            let mut notes = list_notes(&root)?;
            if let Some(f) = &o.folder {
                let prefix = format!("{}/", f.trim_matches('/'));
                notes.retain(|n| n.id.starts_with(&prefix));
            }
            print_notes(&notes, has("--json"));
        }
        "search" => {
            let q = o.positional.join(" ").to_lowercase();
            if q.is_empty() {
                return Err("search needs some text".into());
            }
            let notes: Vec<_> = list_notes(&root)?
                .into_iter()
                .filter(|n| n.title.to_lowercase().contains(&q) || n.content.to_lowercase().contains(&q))
                .collect();
            print_notes(&notes, has("--json"));
        }
        "show" | "cat" => {
            let path = resolve(&root, &one(&o.positional, "show")?)?;
            print!("{}", std::fs::read_to_string(&path).map_err(|e| e.to_string())?);
        }
        "new" => {
            let piped = read_stdin()?;
            let title = if o.positional.is_empty() {
                piped.as_deref().map(extract_title).unwrap_or_else(|| "Untitled".into())
            } else {
                o.positional.join(" ")
            };
            let body = match piped {
                Some(text) if !o.positional.is_empty() && !has_heading(&text) => {
                    format!("# {}\n\n{}", title, text)
                }
                Some(text) => text,
                None => format!("# {}\n\n", title),
            };
            let id = create(&root, o.folder.as_deref(), &title, &body)?;
            println!("{}", id);
            if has("--open") {
                open_in_app(&abs_path_from_id(&root, &id)?)?;
            }
        }
        "edit" => {
            let path = resolve(&root, &one(&o.positional, "edit")?)?;
            match read_stdin()? {
                Some(text) if has("--append") => {
                    let mut f = std::fs::OpenOptions::new().append(true).open(&path).map_err(|e| e.to_string())?;
                    let current = std::fs::read_to_string(&path).unwrap_or_default();
                    let sep = if current.is_empty() || current.ends_with('\n') { "" } else { "\n" };
                    write!(f, "{}{}", sep, text).map_err(|e| e.to_string())?;
                }
                Some(text) => std::fs::write(&path, text).map_err(|e| e.to_string())?,
                None => {
                    let editor = std::env::var("VISUAL")
                        .or_else(|_| std::env::var("EDITOR"))
                        .unwrap_or_else(|_| "vi".into());
                    let status = std::process::Command::new("sh")
                        .arg("-c")
                        .arg(format!("{} \"$1\"", editor))
                        .arg("sh")
                        .arg(&path)
                        .status()
                        .map_err(|e| e.to_string())?;
                    if !status.success() {
                        return Err(format!("{} exited with {}", editor, status));
                    }
                }
            }
        }
        "rm" => {
            let path = resolve(&root, &one(&o.positional, "rm")?)?;
            if !has("-f") && !confirm(&format!("Delete {}?", path.display()))? {
                return Err("cancelled".into());
            }
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        _ => unreachable!(),
    }
    Ok(())
}

fn one(p: &[String], cmd: &str) -> Result<String, String> {
    if p.is_empty() {
        return Err(format!("{} needs a note", cmd));
    }
    Ok(p.join(" "))
}

/// --dir, $SCRATCH_NOTES_DIR, then the notes folder saved by Scratch Plus or Scratch.
fn notes_root(dir: Option<&str>) -> Result<PathBuf, String> {
    let chosen = dir
        .map(String::from)
        .or_else(|| std::env::var("SCRATCH_NOTES_DIR").ok())
        .or_else(saved_notes_folder)
        .ok_or("no notes folder: open the app once, or pass --dir / set SCRATCH_NOTES_DIR")?;
    PathBuf::from(&chosen)
        .canonicalize()
        .map_err(|_| format!("notes folder not found: {}", chosen))
}

fn saved_notes_folder() -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    ["nl.funky-monkey.scratch-plus", "com.scratch.app"].iter().find_map(|id| {
        let path = Path::new(&home).join("Library/Application Support").join(id).join("config.json");
        let json: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
        json.get("notes_folder")?.as_str().map(String::from)
    })
}

struct CliNote {
    id: String,
    title: String,
    modified: i64,
    content: String,
}

fn list_notes(root: &Path) -> Result<Vec<CliNote>, String> {
    let ignored = get_effective_ignored_dirs(&load_settings(&root.to_string_lossy()));
    let mut notes = Vec::new();
    for entry in walkdir::WalkDir::new(root)
        .max_depth(10)
        .into_iter()
        .filter_entry(|e| is_visible_notes_entry(e, &ignored))
        .flatten()
    {
        let Some(id) = id_from_abs_path(root, entry.path(), &ignored) else { continue };
        if is_agent_doc_id(&id) || !entry.path().is_file() {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(entry.path()) else { continue };
        let modified = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_secs() as i64);
        notes.push(CliNote { id, title: extract_title(&content), modified, content });
    }
    notes.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(notes)
}

fn print_notes(notes: &[CliNote], json: bool) {
    if json {
        let rows: Vec<_> = notes
            .iter()
            .map(|n| serde_json::json!({ "id": n.id, "title": n.title, "modified": n.modified }))
            .collect();
        println!("{}", serde_json::to_string_pretty(&rows).unwrap_or_default());
        return;
    }
    for n in notes {
        let date = chrono::DateTime::from_timestamp(n.modified, 0)
            .map(|d| d.with_timezone(&chrono::Local).format("%Y-%m-%d %H:%M").to_string())
            .unwrap_or_default();
        println!("{}  {}  {}", date, n.id, if n.title != leaf(&n.id) { &n.title } else { "" });
    }
}

fn leaf(id: &str) -> &str {
    id.rsplit('/').next().unwrap_or(id)
}

/// Accepts a note ID, a path to the .md file, or a unique title (case-insensitive).
fn resolve(root: &Path, query: &str) -> Result<PathBuf, String> {
    let as_path = PathBuf::from(query);
    if as_path.is_file() {
        let canonical = as_path.canonicalize().map_err(|e| e.to_string())?;
        if !canonical.starts_with(root) {
            return Err(format!("{} is not inside the notes folder", query));
        }
        return Ok(canonical);
    }
    let id = query.strip_suffix(".md").unwrap_or(query);
    if let Ok(path) = abs_path_from_id(root, id) {
        if path.is_file() {
            return Ok(path);
        }
    }
    let q = query.to_lowercase();
    let matches: Vec<_> = list_notes(root)?
        .into_iter()
        .filter(|n| n.title.to_lowercase() == q || leaf(&n.id).to_lowercase() == q)
        .collect();
    match matches.as_slice() {
        [one] => abs_path_from_id(root, &one.id),
        [] => Err(format!("no note matches '{}'", query)),
        many => Err(format!(
            "'{}' matches several notes, use the ID:\n  {}",
            query,
            many.iter().map(|n| n.id.as_str()).collect::<Vec<_>>().join("\n  ")
        )),
    }
}

/// Same naming as the app: file name from the title, `-2`, `-3`... when taken.
fn create(root: &Path, folder: Option<&str>, title: &str, body: &str) -> Result<String, String> {
    let leaf = sanitize_filename(title);
    let base = match folder.map(|f| f.trim_matches('/')).filter(|f| !f.is_empty()) {
        Some(f) => format!("{}/{}", f, leaf),
        None => leaf,
    };
    let mut id = base.clone();
    let mut n = 2;
    while abs_path_from_id(root, &id)?.exists() {
        id = format!("{}-{}", base, n);
        n += 1;
    }
    let path = abs_path_from_id(root, &id)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, body).map_err(|e| e.to_string())?;
    Ok(id)
}

fn has_heading(text: &str) -> bool {
    text.lines().find(|l| !l.trim().is_empty()).is_some_and(|l| l.trim_start().starts_with("# "))
}

fn read_stdin() -> Result<Option<String>, String> {
    let mut stdin = std::io::stdin();
    if stdin.is_terminal() {
        return Ok(None);
    }
    let mut s = String::new();
    stdin.read_to_string(&mut s).map_err(|e| e.to_string())?;
    Ok(Some(s))
}

fn confirm(question: &str) -> Result<bool, String> {
    if !std::io::stdin().is_terminal() {
        return Err("refusing to delete without a terminal; use -f".into());
    }
    eprint!("{} [y/N] ", question);
    let mut answer = String::new();
    std::io::stdin().read_line(&mut answer).map_err(|e| e.to_string())?;
    Ok(matches!(answer.trim(), "y" | "Y" | "yes"))
}

fn open_in_app(path: &Path) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    std::process::Command::new(exe)
        .arg(path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crud_round_trip() {
        let dir = std::env::temp_dir().join(format!("scratch-cli-test-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("Work")).unwrap();
        let root = dir.canonicalize().unwrap();

        let id = create(&root, Some("Work"), "Plan: Q4", "# Plan: Q4\n\nhello\n").unwrap();
        assert_eq!(id, "Work/Plan- Q4");
        assert_eq!(create(&root, Some("Work"), "Plan: Q4", "x").unwrap(), "Work/Plan- Q4-2");

        // resolve by ID, by .md path, and by unique title; ambiguous title errors
        let path = resolve(&root, "Work/Plan- Q4").unwrap();
        assert_eq!(resolve(&root, &path.to_string_lossy()).unwrap(), path);
        assert!(resolve(&root, "plan: q4").is_ok());
        assert!(resolve(&root, "../etc/passwd").is_err());

        let notes = list_notes(&root).unwrap();
        assert_eq!(notes.len(), 2);

        std::fs::remove_file(&path).unwrap();
        assert!(resolve(&root, "Work/Plan- Q4").is_err());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
