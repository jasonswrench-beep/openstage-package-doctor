// No console window behind the program in a release build.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    openstage_package_doctor_lib::run();
}
