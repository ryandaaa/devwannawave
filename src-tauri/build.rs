fn main() {
    #[cfg(unix)]
    {
        use std::{fs, os::unix::fs::PermissionsExt, path::Path};

        for path in [
            Path::new("scripts/linux/dww"),
            Path::new("scripts/linux/postinstall.sh"),
            Path::new("scripts/macos/dww"),
        ] {
            if let Ok(metadata) = fs::metadata(path) {
                let mut permissions = metadata.permissions();
                permissions.set_mode(0o755);
                let _ = fs::set_permissions(path, permissions);
            }
        }
    }

    tauri_build::build();
}
