mod app;
mod db;
mod git;
mod message;
mod model;
mod names;
mod ui;

use app::App;

const ICON_PNG: &[u8] = include_bytes!("../assets/logo.png");

fn main() -> iced::Result {
    set_dock_icon();

    let icon = image::load_from_memory_with_format(ICON_PNG, image::ImageFormat::Png)
        .map(|img| {
            img.resize(256, 256, image::imageops::FilterType::Lanczos3)
                .into_rgba8()
        })
        .map_err(|e| eprintln!("Warning: failed to decode window icon: {e}"))
        .ok()
        .and_then(|img| {
            let (w, h) = img.dimensions();
            iced::window::icon::from_rgba(img.into_raw(), w, h).ok()
        });

    let window_settings = iced::window::Settings {
        icon,
        ..iced::window::Settings::default()
    };

    iced::application(App::new, App::update, App::view)
        .title("Claudette")
        .window(window_settings)
        .theme(App::theme)
        .subscription(App::subscription)
        .centered()
        .run()
}

/// Sets the macOS dock icon programmatically.
///
/// On macOS, `iced::window::Settings::icon` only affects the titlebar (which macOS doesn't
/// display). The dock icon requires either an `.app` bundle or setting it via NSApplication.
/// This ensures the icon appears during `cargo run` without a bundle.
#[cfg(target_os = "macos")]
fn set_dock_icon() {
    use objc2::AnyThread;
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::{MainThreadMarker, NSData};

    let Some(mtm) = MainThreadMarker::new() else {
        eprintln!("Warning: not on main thread, skipping dock icon");
        return;
    };

    unsafe {
        let data =
            NSData::initWithBytes_length(NSData::alloc(), ICON_PNG.as_ptr().cast(), ICON_PNG.len());
        if let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) {
            let app = NSApplication::sharedApplication(mtm);
            app.setApplicationIconImage(Some(&image));
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn set_dock_icon() {}
