# DS PLIX

A local media library for files on Windows drives, SMB shares, and FTP servers. The scanner indexes video files and uses TMDB for movie and TV artwork and details. FFmpeg and FFprobe are installed with the Node dependencies for media inspection and HLS playback.

The home page features a rotating selection of recently added titles. Use its arrows or title indicators to browse; rotation pauses while the carousel is hovered or focused and stays off when reduced motion is preferred.

## Run

1. Install Node.js 20 or newer and run `npm install` in this folder. Allow the FFmpeg and FFprobe package install scripts so their platform binaries are downloaded.
2. Set `TMDB_API_KEY` in `.env` or save the key in **Settings**. A key saved in Settings takes priority and takes effect without a restart.
3. Run `npm start` and open `http://localhost:3030` (or the port in `.env`).
4. Open **Settings → Library Sources** to add a local path, UNC SMB share, or FTP directory. For an FTP drive, select **Choose folders**, browse to the folder you want, and click **Use this folder**. Repeat for each folder you want to index, then choose **Scan All Libraries**.

For videos already on this laptop, use **Settings → Browse laptop files**. Pick a folder to index recursively, or tick individual video files and add only those. The app reads the existing files in place; it does not upload or duplicate them. The laptop browser is available when the app is opened on the same computer as the server. New selections begin indexing immediately; if another scan is running, use **Scan All Libraries** afterward.

For an authenticated FTP directory, enter a URL such as `ftp://user:password@192.168.1.1/Movies/`. Each directory should be a separate source. The URL is stored locally in `data/ds-plix.db`; the app removes its password from library and media API responses. Keep this server on a trusted network.

Choosing a folder adds it as an enabled source and pauses its parent drive. You can turn sources on or off with the **Scan** checkbox. Existing library entries stay visible until the next full scan; that scan removes entries outside the enabled folders.

The scan makes files visible first, then fills in TMDB metadata. Camera-style filenames and videos under `DCIM` are indexed without movie matching. MP4 files can stream with HTTP byte ranges; other formats use FFmpeg HLS when needed. FTP files are proxied through the app because some routers do not support FFmpeg's FTP client.

Open a video's details and select **Get info** (or **Change info**) to search TMDB and choose the exact movie or show. **Remove info** clears an attached TMDB match. Manual selections and removals stay in place during later library scans. FTP video playback uses cached technical details when available; MP4 starts without waiting for a fresh codec probe, while unsupported formats generate short HLS segments on demand.

## Subtitles and private play

Open a video's details to add a local UTF-8 `.srt` or `.vtt` file (up to 2 MB). The app converts SRT to WebVTT and offers the track in the player's caption menu. Added tracks can be removed from the same details screen.

For online subtitles, enter an [OpenSubtitles.com API key](https://opensubtitles.tawk.help/article/getting-started), username, and password under **Settings → Online subtitles**. Then choose **Find online** in a video's details and select a result. The server searches by the attached TMDB ID when available, or by title. OpenSubtitles applies its own download limits. Credentials stay in the laptop's local `data/ds-plix.db` and are masked in settings responses; keep this server on a trusted LAN.

Choose **Private play** in the header, browse a laptop folder, and select **Play privately** beside a video. Playback uses a temporary session and does not add the file to the library or record watch history. A subtitle file can be attached in the private player for that session. Private playback is available from the laptop browser; its temporary stream ends when you close the player or after four hours. The app clears temporary transcode files on close, expiry, and server restart.

## Android TV and Fire TV

The [TV app project](android-tv/) wraps the DS PLIX interface for a TV remote. It connects to this laptop over the local network; the laptop must remain on and `npm start` must keep running. In **Settings → Android TV & Fire TV**, note the displayed `http://<laptop-ip>:3030` address. If the TV cannot connect, allow port 3030 for private networks in Windows Firewall and check that both devices use the same LAN.

To build the APK, open `android-tv` in Android Studio with JDK 17 and Android SDK 35 installed, sync Gradle 8.13 / Android Gradle Plugin 8.13.2, then use **Build → Build Bundle(s) / APK(s) → Build APK(s)**. The output is `android-tv/app/build/outputs/apk/debug/app-debug.apk`. Install that APK on Android TV or Fire TV using Android Studio's device installer or `adb install -r app-debug.apk` with developer mode and debugging enabled on the device. Launch DS PLIX TV, enter the laptop address, and use the remote's Menu button to change it later. The APK contains the client only; it does not copy videos to the TV.

The APK is not prebuilt in this repository. A device's WebView and codecs affect playback; unsupported formats use the laptop's FFmpeg HLS transcoder.

Run regression checks with `npm test`.
