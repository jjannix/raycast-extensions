import { Action, ActionPanel, Icon, List, showToast, Toast } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { execa } from "execa";
import { getytdlPath, sanitizeVideoTitle, forceIpv4, formatHHMM } from "../utils";
import { Video } from "../types";

interface BulkDetailsListProps {
  urls: string[];
}

export default function BulkDetailsList({ urls }: BulkDetailsListProps) {
  const { data: videos, isLoading } = usePromise(
    async (urls: string[]) => {
      if (urls.length === 0) return [];

      const ytdlPath = getytdlPath();

      // We process in batches to avoid command line length limits or timeouts if too many
      // But for reasonable bulk (e.g. < 50), one call usually works.
      // yt-dlp prints one JSON per line for each video.

      try {
        const result = await execa(
          ytdlPath,
          [
            forceIpv4 ? "--force-ipv4" : "",
            "--dump-json",
            "--ignore-errors", // Don't fail all if one fails
            "--no-warnings",
            "--extractor-args",
            "youtube:player_client=android_vr",
            ...urls,
          ].filter((x) => Boolean(x)),
        );

        const lines = result.stdout.split("\n").filter((line) => line.trim().length > 0);
        const parsedVideos = lines
          .map((line) => {
            try {
              const data = JSON.parse(line) as Video;
              return { ...data, title: sanitizeVideoTitle(data.title) };
            } catch {
              return null;
            }
          })
          .filter((v): v is Video => v !== null);

        return parsedVideos;
      } catch (error) {
        showToast({
          style: Toast.Style.Failure,
          title: "Failed to fetch details",
          message: String(error),
        });
        return [];
      }
    },
    [urls],
  );

  return (
    <List isLoading={isLoading} isShowingDetail>
      {videos?.map((video, index) => (
        <List.Item
          key={index} // Video ID might be duplicated or missing if error, so index is safer for key
          title={video.title}
          subtitle={video.uploader}
          icon={video.thumbnail ? { source: video.thumbnail } : Icon.Video}
          detail={
            <List.Item.Detail
              markdown={`
          # ${video.title}
          
          <img src="${video.thumbnail}" alt="Thumbnail" height="200" />
          
          ${video.description || "No description available."}
          
          ---
          
          **Uploader:** ${video.uploader}
          **Platform:** ${video.extractor_key}
          **Duration:** ${video.duration ? formatHHMM(video.duration) : "N/A"}
          **View Count:** ${video.view_count?.toLocaleString() || "N/A"}
          **Upload Date:** ${
            video.upload_date
              ? `${video.upload_date.slice(0, 4)}-${video.upload_date.slice(4, 6)}-${video.upload_date.slice(6, 8)}`
              : "N/A"
          }
          **URL:** ${video.webpage_url}
                        `}
            />
          }
          actions={
            <ActionPanel>
              <Action.OpenInBrowser url={video.webpage_url} />
              <Action.CopyToClipboard content={video.webpage_url} title="Copy URL" />
            </ActionPanel>
          }
        />
      ))}
      {!isLoading && videos?.length === 0 && (
        <List.EmptyView title="No details found" description="Could not fetch metadata for the provided URLs." />
      )}
    </List>
  );
}
