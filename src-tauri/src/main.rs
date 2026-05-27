// Prevents a CMD/console window from appearing on Windows when launching the app.
// This attribute is ignored on macOS and Linux.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    devwannawave_lib::run();
}
