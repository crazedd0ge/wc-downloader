# Weeb Central Archiver

I created this script because I wanted to read manga offline. I found that existing tools for downloading manga were subpar, so I decided to build my own. This script allows you to download manga from Weeb Central and read it in any way you prefer.

## Important Information

This script is still a **work in progress (WIP)**. While it functions, don’t expect it to be flawless—it’s a first draft. I plan to expand its features in the future, including adding a user interface, but for now, it gets the job done.

## What Does This Script Do?

### The Output

The script is designed to download entire manga volumes at a time. With the correct configuration, it will:
1. Download all images for a chapter.
2. Pack the chapter into a `.CBZ` file.
3. Repeat the process for all chapters in a volume.
4. Once all chapters are downloaded, it will pack them into a single `.CBZ` file for the entire volume.

### Configuration

To use this script, you’ll need the following:
1. The **ID** of the manga you want to download from Weeb Central. This ID can be found in the URL of the manga on Weeb Central. For example, the URL might look like this:`https://weebcentral.com/series/01J76XYDGDQERFSK333582BNBZ/Sousou-no-Frieren`Here, the ID is `01J76XYDGDQERFSK333582BNBZ`.

2. Open `main.js` and update the following variables:
- `SERIES_ID`: Replace this with the manga's ID.
- `MANGA_TITLE`: Replace this with the manga's title (e.g., `Frieren - Beyond Journey's End`).
- `OUTPUT_FOLDER`: Specify the folder path where the downloaded content will be saved.
- `PROGRESS_FOLDER`: Specify the folder path for the progress log.
- `VOLUME_MAPPING`: This is used to define how chapters are grouped into volumes. For example:
  ```json
  {
    1: ["Chapter 1", "Chapter 2"],
    2: ["Chapter 3", "Chapter 4"]
  }
  ```
  **Note:** The chapter names must exactly match the names on Weeb Central, or the script will not work.

### Running the Script

Once you’ve configured the variables:
1. Open a terminal in the script's directory.
2. Run the command: `node main.js`

Depending on the number of chapters, this process may take some time. The script includes a 1-second delay between image downloads to avoid overwhelming Weeb Central’s servers and to stay under the radar.

**Disclaimer:** I am not responsible if you get IP-banned from Weeb Central. Use this script responsibly.

---

## Script Features

- **Progress Tracking:** The script keeps track of downloaded chapters and completed volumes, so you can resume interrupted downloads - *Currently WIP and doesnt work*
- **Error Handling:** It includes retry mechanisms for failed downloads and logs errors for troubleshooting.
- **CBZ Creation:** Chapters and volumes are neatly packed into `.CBZ` files, which are widely supported by manga readers.

## Future Plans
- Add a user interface (UI) for easier configuration and monitoring.
    - Weeb Central look ups etc
- Fully Dockerized
- Improved error handling and user feedback.

---

## Code Overview

The script is written in JavaScript and uses the following libraries:
- **Playwright**: For browser automation to scrape chapter links and images.
- **Node-Fetch**: For downloading images.
- **Archiver**: For creating `.CBZ` files.
- **Unzipper**: For extracting `.CBZ` files during volume creation.

### Key Functions

- **`getChapterLinks`**: Fetches all chapter links from the manga's series page.
- **`downloadImage`**: Downloads individual images with retry logic.
- **`createCBZ`**: Packs images into `.CBZ` files.
- **`createVolumeCBZ`**: Combines chapter `.CBZ` files into a single volume `.CBZ`.
- **`ProgressTracker`**: Tracks downloaded chapters and completed volumes to avoid redundant work.

---

## License

This project is open-source and available under the [MIT License](license.txt). Use it at your own risk.

---

Enjoy your offline manga reading! 📚