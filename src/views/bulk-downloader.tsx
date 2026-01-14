import {
  Action,
  ActionPanel,
  BrowserExtension,
  Clipboard,
  Form,
  Icon,
  getSelectedText,
  open,
  showHUD,
  showToast,
  Toast,
} from "@raycast/api";
import { useForm } from "@raycast/utils";
import { useEffect, useState } from "react";
import { ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import {
  autoLoadUrlFromClipboard,
  autoLoadUrlFromSelectedText,
  downloadPath,
  enableBrowserExtensionSupport,
  getffmpegPath,
  getytdlPath,
  isAudioOnlyFormat,
  isMac,
  isValidUrl,
  parseFormatValue,
} from "../utils";
import BulkDetailsList from "./bulk-details-list";

interface BulkDownloadFormValues {
  urls: string;
  format: string;
}

export default function BulkDownloader() {
  const [downloading, setDownloading] = useState(false);
  const { handleSubmit, itemProps, setValue, values } = useForm<BulkDownloadFormValues>({
    initialValues: {
      urls: "",
      format: "video|bestvideo+bestaudio/best#mp4",
    },
    onSubmit: async (values) => {
      const urls = values.urls.split("\n").filter((url) => isValidUrl(url));
      if (urls.length === 0) {
        showToast({
          style: Toast.Style.Failure,
          title: "No valid URLs found",
        });
        return;
      }

      setDownloading(true);
      const toast = await showToast({
        title: `Downloading ${urls.length} videos...`,
        style: Toast.Style.Animated,
      });

      let activeProcess: ChildProcess | null = null;
      let isCancelled = false;

      toast.primaryAction = {
        title: "Stop Download",
        shortcut: { modifiers: ["cmd"], key: "." },
        onAction: () => {
          isCancelled = true;
          if (activeProcess) {
            activeProcess.kill();
          }
          toast.title = "Download Cancelled";
          toast.style = Toast.Style.Failure;
          toast.message = "Bulk download was stopped";
          toast.primaryAction = undefined;
          setDownloading(false);
        },
      };

      let successCount = 0;

      for (const [index, url] of urls.entries()) {
        if (isCancelled) break;

        toast.title = `Downloading video ${index + 1} of ${urls.length}`;
        toast.message = "Starting...";

        try {
          await new Promise<void>((resolve, reject) => {
            const ytdlPath = getytdlPath();
            const ffmpegPath = getffmpegPath();
            const options = ["-o", path.join(downloadPath, `%(title)s (%(id)s).%(ext)s`)];
            const { downloadFormat, recodeFormat } = parseFormatValue(values.format);

            options.push("--ffmpeg-location", ffmpegPath);
            options.push("--format", downloadFormat);
            options.push("--recode-video", recodeFormat);
            options.push("--extractor-args", "youtube:player_client=android_vr");

            // Progress output
            options.push("--progress");

            const isAudioOnly = isAudioOnlyFormat(values.format);
            const mediaType = isAudioOnly ? "Audio" : "Video";

            activeProcess = spawn(ytdlPath, [...options, url]);

            activeProcess.stdout?.on("data", (data) => {
              const line = data.toString() as string;
              const progress = Number(/\[download\]\s+(\d+(\.\d+)?)%.*/.exec(line)?.[1]);
              if (progress) {
                toast.message = `${Math.floor(progress)}%`;
              }
            });

            activeProcess.on("close", (code) => {
              if (code === 0) {
                successCount++;
                resolve();
              } else {
                if (isCancelled) {
                  reject(new Error("Cancelled"));
                } else {
                  reject(new Error(`Failed to download ${mediaType}`));
                }
              }
            });

            activeProcess.on("error", (err) => {
              reject(err);
            });
          });
        } catch (error) {
          if (isCancelled) break;
          console.error(`Error downloading ${url}:`, error);
        }
      }

      if (isCancelled) return;

      setDownloading(false);

      const failures = urls.length - successCount;
      if (failures > 0 && successCount > 0) {
        toast.style = Toast.Style.Failure;
        toast.title = "Bulk download finished with errors";
        toast.message = `${successCount} downloaded, ${failures} failed`;
      } else if (failures === urls.length) {
        toast.style = Toast.Style.Failure;
        toast.title = "Bulk download failed";
        toast.message = "All downloads failed";
      } else {
        toast.style = Toast.Style.Success;
        toast.title = "Bulk download complete";
        toast.message = `Downloaded ${successCount} videos`;
      }

      toast.primaryAction = {
        title: isMac ? "Open in Finder" : "Open in Explorer",
        shortcut: { modifiers: ["cmd", "shift"], key: "o" },
        onAction: () => {
          open(downloadPath);
        },
      };
      toast.secondaryAction = {
        title: "Copy to Clipboard",
        shortcut: { modifiers: ["cmd", "shift"], key: "c" },
        onAction: () => {
          Clipboard.copy({ file: downloadPath });
          showHUD("Copied to Clipboard");
        },
      };
    },
  });

  useEffect(() => {
    (async () => {
      const foundUrls: string[] = [];

      if (autoLoadUrlFromClipboard) {
        const clipboardText = await Clipboard.readText();
        if (clipboardText) {
          const lines = clipboardText.split(/\r?\n/);
          lines.forEach((line) => {
            const trimmed = line.trim();
            if (isValidUrl(trimmed)) foundUrls.push(trimmed);
          });
        }
      }

      if (autoLoadUrlFromSelectedText) {
        try {
          const selectedText = await getSelectedText();
          if (selectedText) {
            const lines = selectedText.split(/\r?\n/);
            lines.forEach((line) => {
              const trimmed = line.trim();
              if (isValidUrl(trimmed)) foundUrls.push(trimmed);
            });
          }
        } catch {
          // Suppress
        }
      }

      if (enableBrowserExtensionSupport) {
        try {
          const tabUrl = (await BrowserExtension.getTabs()).find((tab) => tab.active)?.url;
          if (tabUrl && isValidUrl(tabUrl)) foundUrls.push(tabUrl);
        } catch {
          // Suppress
        }
      }

      if (foundUrls.length > 0) {
        const unique = [...new Set(foundUrls)];
        setValue("urls", unique.join("\n"));
      }
    })();
  }, []);

  return (
    <Form
      isLoading={downloading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Download All" icon={Icon.Download} onSubmit={handleSubmit} />
          {values.urls.trim().length > 0 && (
            <Action.Push
              title="Show Details"
              icon={Icon.Sidebar}
              target={<BulkDetailsList urls={values.urls.split("\n").filter((u) => isValidUrl(u))} />}
              shortcut={{ modifiers: ["cmd"], key: "d" }}
            />
          )}
        </ActionPanel>
      }
      searchBarAccessory={
        <Form.LinkAccessory
          text="Supported Sites"
          target="https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md"
        />
      }
    >
      <Form.TextArea {...itemProps.urls} title="Video URLs" placeholder="Enter video URLs, one per line" />
      <Form.Dropdown {...itemProps.format} title="Format">
        <Form.Dropdown.Section title="Video">
          <Form.Dropdown.Item value="video|bestvideo+bestaudio/best#mp4" title="Best Video (MP4)" />
          <Form.Dropdown.Item value="video|bestvideo+bestaudio/best#webm" title="Best Video (WebM)" />
          <Form.Dropdown.Item value="video|bestvideo+bestaudio/best#mkv" title="Best Video (MKV)" />
          <Form.Dropdown.Item
            value="video|bestvideo[height<=2160]+bestaudio/best[height<=2160]#mp4"
            title="2160p (4K) (MP4)"
          />
          <Form.Dropdown.Item
            value="video|bestvideo[height<=1440]+bestaudio/best[height<=1440]#mp4"
            title="1440p (2K) (MP4)"
          />
          <Form.Dropdown.Item
            value="video|bestvideo[height<=1080]+bestaudio/best[height<=1080]#mp4"
            title="1080p (MP4)"
          />
          <Form.Dropdown.Item value="video|bestvideo[height<=720]+bestaudio/best[height<=720]#mp4" title="720p (MP4)" />
          <Form.Dropdown.Item value="video|bestvideo[height<=480]+bestaudio/best[height<=480]#mp4" title="480p (MP4)" />
        </Form.Dropdown.Section>
        <Form.Dropdown.Section title="Audio">
          <Form.Dropdown.Item value="audio|bestaudio/best#mp3" title="Best Audio (MP3)" />
          <Form.Dropdown.Item value="audio|bestaudio/best#m4a" title="Best Audio (M4A)" />
          <Form.Dropdown.Item value="audio|bestaudio/best#flac" title="Best Audio (FLAC)" />
          <Form.Dropdown.Item value="audio|bestaudio/best#wav" title="Best Audio (WAV)" />
        </Form.Dropdown.Section>
      </Form.Dropdown>
    </Form>
  );
}
