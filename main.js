import { chromium } from "playwright";
import * as fs from "fs/promises";
import { createWriteStream, createReadStream } from "node:fs";
import path from "path";
import fetch from "node-fetch";
import archiver from "archiver";
import { Extract } from "unzipper";

// Folder Configuration
const OUTPUT_FOLDER = "";
const PROGRESS_FOLDER = "";

// Configuration and Execution
const MANGA_TITLE = "";
const SERIES_ID = "";
const SERIES_URL = `https://weebcentral.com/series/${SERIES_ID}/full-chapter-list`;

const VOLUME_MAPPING = {
  1: ["Chapter 1"],
};

class ProgressTracker {
  constructor(mangaTitle) {
    this.progressFile = path.join(PROGRESS_FOLDER, `${mangaTitle}_progress.json`);
    this.progress = null;
  }

  async loadProgress() {
    try {
      const data = await fs.readFile(this.progressFile, "utf8");
      this.progress = JSON.parse(data);
    } catch {
      this.progress = {
        downloadedChapters: [],
        completedVolumes: [],
        lastAttempt: null,
      };
    }
    return this.progress;
  }

  async saveProgress() {
    try {
      await fs.writeFile(
        this.progressFile,
        JSON.stringify(this.progress, null, 2)
      );
    } catch (error) {
      await logError("Failed to save progress", error);
    }
  }

  async markChapterComplete(chapterName) {
    if (!this.progress.downloadedChapters.includes(chapterName)) {
      this.progress.downloadedChapters.push(chapterName);
      await this.saveProgress();
    }
  }

  async markVolumeComplete(volumeNumber) {
    if (!this.progress.completedVolumes.includes(volumeNumber)) {
      this.progress.completedVolumes.push(volumeNumber);
      await this.saveProgress();
    }
  }

  isChapterDownloaded(chapterName) {
    return this.progress.downloadedChapters.includes(chapterName);
  }

  isVolumeCompleted(volumeNumber) {
    return this.progress.completedVolumes.includes(volumeNumber);
  }
}

// Logging Functions
async function logError(message, error, volumeDir = null) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ERROR: ${message}\n${
    error.stack || error
  }\n\n`;

  console.error(logMessage);

  if (volumeDir) {
    const logPath = path.join(volumeDir, "log.txt");
    try {
      await fs.appendFile(logPath, logMessage);
    } catch (err) {
      console.error("Failed to write to log file:", err);
    }
  }
}

async function logInfo(message, volumeDir = null) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] INFO: ${message}\n`;

  console.log(message);

  if (volumeDir) {
    const logPath = path.join(volumeDir, "log.txt");
    try {
      await fs.appendFile(logPath, logMessage);
    } catch (err) {
      console.error("Failed to write to log file:", err);
    }
  }
}

// Enhanced Utility Functions
async function ensureDir(dirPath) {
  try {
    await fs.access(dirPath);
  } catch {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      await logError(`Failed to create directory ${dirPath}`, error);
      throw error;
    }
  }
}

async function downloadImage(url, filepath, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(`HTTP error! status: ${response.status}`);
      const buffer = await response.arrayBuffer();
      await fs.writeFile(filepath, Buffer.from(buffer));
      await logInfo(`Downloaded: ${filepath}`);
      return true;
    } catch (error) {
      await logError(
        `Attempt ${attempt}/${retries} failed to download ${url}`,
        error
      );
      if (attempt === retries) return false;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  return false;
}

// Enhanced Browser Functions
async function getChapterImages(chapterUrl, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(chapterUrl, { timeout: 30000 });
      await page.waitForSelector("section[hx-get]", { timeout: 10000 });
      await page.waitForTimeout(2000);

      const imageUrls = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("img"))
          .filter((img) => {
            const src = img.getAttribute("src");
            return (
              src &&
              (/manga.*\d+/.test(src) ||
                /\d{3,4}(-\d{3})?\.(?:png|jpg|jpeg|webp)$/i.test(src))
            );
          })
          .map((img) => img.src);
      });

      await browser.close();
      return imageUrls;
    } catch (error) {
      await browser.close();
      await logError(
        `Attempt ${attempt}/${retries} failed to get images for chapter ${chapterUrl}`,
        error
      );
      if (attempt === retries) return [];
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  return [];
}

// Enhanced CBZ Creation Functions
async function createCBZ(sourceDir, outputPath, comicInfo = null, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const output = createWriteStream(outputPath);
        const archive = archiver("zip", {
          zlib: { level: 9 },
        });

        output.on("close", resolve);
        archive.on("error", reject);
        output.on("error", reject);

        archive.pipe(output);

        if (comicInfo) {
          archive.append(comicInfo, { name: "ComicInfo.xml" });
        }

        archive.directory(sourceDir, false);
        archive.finalize();
      });

      await logInfo(`CBZ created: ${outputPath}`);
      return true;
    } catch (error) {
      await logError(
        `Attempt ${attempt}/${retries} failed to create CBZ ${outputPath}`,
        error
      );
      if (attempt === retries) return false;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  return false;
}

// Enhanced Volume Processing Function
async function createVolumeCBZ(
  sourceDir,
  volumeNumber,
  chapters,
  mangaTitle,
  progressTracker
) {
  if (progressTracker.isVolumeCompleted(volumeNumber)) {
    await logInfo(`Volume ${volumeNumber} already completed, skipping`);
    return true;
  }

  const tempDir = path.join(
    process.cwd(),
    `temp_volume_${volumeNumber}_${Date.now()}`
  );
  const volumeDir = path.join(process.cwd(), `${mangaTitle}_Volumes`);

  try {
    await ensureDir(tempDir);
    await ensureDir(volumeDir);

    let pageCounter = 1;
    let success = true;

    for (const chapterName of chapters) {
      try {
        const chapterPath = path.join(sourceDir, `${chapterName}.cbz`);
        const chapterTempDir = path.join(tempDir, chapterName);

        await ensureDir(chapterTempDir);
        await new Promise((resolve, reject) => {
          createReadStream(chapterPath)
            .pipe(Extract({ path: chapterTempDir }))
            .on("error", reject)
            .on("close", resolve);
        });

        const files = await fs.readdir(chapterTempDir);
        for (const file of files.sort()) {
          if (
            file !== "ComicInfo.xml" &&
            /\.(jpg|jpeg|png|webp)$/i.test(file)
          ) {
            const extension = path.extname(file);
            const newPath = path.join(
              tempDir,
              `${String(pageCounter).padStart(4, "0")}${extension}`
            );
            await fs.rename(path.join(chapterTempDir, file), newPath);
            pageCounter++;
          }
        }

        await fs.rm(chapterTempDir, { recursive: true, force: true });
      } catch (error) {
        await logError(
          `Error processing chapter ${chapterName} for volume ${volumeNumber}`,
          error,
          volumeDir
        );
        success = false;
      }
    }

    if (success) {
      const comicInfo = createVolumeComicInfo(mangaTitle, volumeNumber);
      const volumePath = path.join(
        volumeDir,
        `${mangaTitle} Volume ${volumeNumber}.cbz`
      );
      success = await createCBZ(tempDir, volumePath, comicInfo);

      if (success) {
        await progressTracker.markVolumeComplete(volumeNumber);
        await logInfo(
          `Created volume ${volumeNumber} at ${volumePath}`,
          volumeDir
        );
      }
    }

    return success;
  } catch (error) {
    await logError(`Error creating volume ${volumeNumber}`, error, volumeDir);
    return false;
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      await logError(
        `Error cleaning up temp directory for volume ${volumeNumber}`,
        error,
        volumeDir
      );
    }
  }
}

async function getChapterLinks(SERIES_URL) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(SERIES_URL);

    const chapters = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href*="/chapters/"]'))
        .map((a) => {
          const chapterName = a
            .querySelector("span.grow span:first-of-type")
            ?.textContent?.trim();
          const releaseDate = a.querySelector("time")?.getAttribute("datetime");
          return {
            url: a.href,
            name: chapterName,
            date: releaseDate,
          };
        })
        .filter((chapter) => chapter.name);
    });

    return chapters;
  } catch (error) {
    console.error("Error getting chapter links:", error);
    return [];
  } finally {
    await browser.close();
  }
}

function createChapterComicInfo(chapterName, volumeNumber, mangaTitle) {
  const chapterNumber = chapterName.match(/\d+/)?.[0] || "0";

  return `<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Series>${mangaTitle}</Series>
  <Number>${chapterNumber}</Number>
  <Volume>${volumeNumber}</Volume>
  <Title>${chapterName}</Title>
  <Summary>Chapter ${chapterNumber} of ${mangaTitle}</Summary>
  <Genre>Manga</Genre>
</ComicInfo>`;
}

function createVolumeComicInfo(mangaTitle, volumeNumber) {
  return `<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Series>${mangaTitle}</Series>
  <Volume>${volumeNumber}</Volume>
  <Title>Volume ${volumeNumber}</Title>
  <Summary>Volume ${volumeNumber} of ${mangaTitle}</Summary>
  <Genre>Manga</Genre>
  <Language>en</Language>
</ComicInfo>`;
}

// Enhanced Main Download Function
async function downloadManga(SERIES_URL, VOLUME_MAPPING = null) {
  const progressTracker = new ProgressTracker(MANGA_TITLE);
  await progressTracker.loadProgress();

  const baseDir = path.join(OUTPUT_FOLDER, MANGA_TITLE);
  const cbzDir = path.join(OUTPUT_FOLDER, `${MANGA_TITLE}_CBZ`);
  const volumeDir = path.join(OUTPUT_FOLDER, `${MANGA_TITLE}_Volumes`);

  try {
    await ensureDir(baseDir);
    await ensureDir(cbzDir);
    await ensureDir(volumeDir);

    await logInfo("Getting chapter links...", volumeDir);
    let chapters = await getChapterLinks(SERIES_URL);
    await logInfo(`Found ${chapters.length} total chapters`, volumeDir);

    if (VOLUME_MAPPING) {
      for (const [volumeNumber, chapterList] of Object.entries(VOLUME_MAPPING)) {
        if (progressTracker.isVolumeCompleted(volumeNumber)) {
          await logInfo(
            `Volume ${volumeNumber} already completed, skipping`,
            volumeDir
          );
          continue;
        }

        await logInfo(`\nProcessing Volume ${volumeNumber}`, volumeDir);

        for (const chapterName of chapterList) {
          if (progressTracker.isChapterDownloaded(chapterName)) {
            await logInfo(
              `Chapter ${chapterName} already downloaded, skipping`,
              volumeDir
            );
            continue;
          }

          const chapter = chapters.find((ch) => ch.name === chapterName);
          if (!chapter) {
            await logError(
              `Chapter ${chapterName} not found`,
              new Error("Chapter not found"),
              volumeDir
            );
            continue;
          }

          await logInfo(`\nProcessing ${chapter.name}`, volumeDir);
          const tempDir = path.join(baseDir, chapter.name);
          await ensureDir(tempDir);

          await logInfo(`Getting images for ${chapter.name}...`, volumeDir);
          const images = await getChapterImages(chapter.url);

          if (images.length === 0) {
            await logError(
              `No images found for chapter ${chapter.name}`,
              new Error("No images found"),
              volumeDir
            );
            continue;
          }

          await logInfo(
            `Found ${images.length} images in chapter ${chapter.name}`,
            volumeDir
          );

          let downloadSuccess = true;
          for (const [imgIndex, imageUrl] of images.entries()) {
            const extension = path.extname(imageUrl) || ".png";
            const filename = `${String(imgIndex + 1).padStart(
              3,
              "0"
            )}${extension}`;
            const filepath = path.join(tempDir, filename);

            if (!(await downloadImage(imageUrl, filepath))) {
              downloadSuccess = false;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
          }

          if (downloadSuccess) {
            const comicInfo = createChapterComicInfo(
              chapter.name,
              volumeNumber,
              MANGA_TITLE
            );
            const cbzPath = path.join(cbzDir, `${chapter.name}.cbz`);
            if (await createCBZ(tempDir, cbzPath, comicInfo)) {
              await progressTracker.markChapterComplete(chapter.name);
            }
          }

          await fs.rm(tempDir, { recursive: true, force: true });
          await logInfo(`Completed chapter ${chapter.name}`, volumeDir);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        // Create volume CBZ after all chapters are downloaded
        await createVolumeCBZ(
          cbzDir,
          volumeNumber,
          chapterList,
          MANGA_TITLE,
          progressTracker
        );
      }
    }

    await logInfo("\nDownload complete!", volumeDir);
  } catch (error) {
    await logError("Error in main process", error, volumeDir);
  }
}

// Execute the download
downloadManga(SERIES_URL, VOLUME_MAPPING).catch(console.error);
