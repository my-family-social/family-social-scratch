"use client";

import type { JSONContent } from "@tiptap/core";
import LinkExtension from "@tiptap/extension-link";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor } from "@tiptap/react";
import { CircleQuestionMark, Edit3, Eye, Heart, HouseHeart, MessageSquare, MessageSquareText, Music, Pause, Play, Plus, SkipBack, SkipForward, Square, ThumbsDown, ThumbsUp } from "lucide-react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  addMusicCommentAction,
  getMusicDetailAction,
  pauseSpotifyPlaylistAction,
  playSpotifyPlaylistAction,
  prepareSpotifyConnectionAction,
  resumeSpotifyPlaylistAction,
  skipToNextSpotifyTrackAction,
  skipToPreviousSpotifyTrackAction,
  stopSpotifyPlaylistAction,
  toggleMusicLikeAction,
} from "@/app/(features)/(music)/music/actions";
import TipTapCommentEditor from "@/components/common/tiptap-comment-editor";
import MemberAvatar from "@/components/common/member-avatar";
import TiptapRenderer from "@/components/discuss/tiptap-renderer";
import type { GuidedTourLaunchPayload } from "@/components/db/sql/queries-guided-runtime";
import {
  createEmptyTipTapDocument,
  isSerializedTipTapDocumentEmpty,
  normalizeSerializedTipTapDocument,
  parseSerializedTipTapDocument,
} from "@/components/db/types/poem-term-validation";
import { MusicDetail, MusicRecord } from "@/components/db/types/music";
import StartDiscussionDialog from "@/components/discuss/start-discussion-dialog";
import FeatureFaqHelp from "@/components/common/feature-faq-help";
import EditPostIcon from "@/components/common/edit-post-icon";
import {
  FilterSidebar,
  FilterSidebarCheckbox,
  FilterSidebarDateScope,
  FilterSidebarGroup,
  FilterSidebarProvider,
  FilterSidebarRadio,
  FilterSidebarSearch,
  FilterSidebarTrigger,
  type FilterSidebarPalette,
} from "@/components/common/filter-sidebar";

const musicFilterPalette: FilterSidebarPalette = {
  sidebarBackground: "#f7fbff",
  sidebarForeground: "#203b66",
  sidebarBorder: "#c8d9f3",
  label: "#2C5EAD",
  muted: "#4a6fae",
  inputBorder: "#c8d9f3",
  inputText: "#203b66",
  chipBorder: "#c8d9f3",
  chipText: "#203b66",
  chipHoverBackground: "#edf4ff",
  checkBorder: "#7aa0dd",
  checkboxText: "#2C5EAD",
  accent: "#2C5EAD",
  accentHoverBackground: "#234c8e",
  triggerBorder: "#c8d9f3",
  triggerBackground: "#f7fbff",
  triggerText: "#2C5EAD",
  triggerHoverBackground: "#edf4ff",
};
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { MemberKeyDetails } from "@/features/family/types/family-steps";
import GuidedTourLauncher from "@/features/guided/components/guided-tour-launcher";
import { MusicScrollStrip } from "@/features/music/components/music-scroll-strip";
import { extractS3KeyFromValue } from "@/lib/s3-object-key";
import {
  clearQueuedFeatureComment,
  createClientRequestId,
  getPwaSyncNowEventName,
  isBrowserOnline,
  queueFeatureComment,
  readQueuedFeatureComments,
} from "@/lib/pwa-background-sync";
import { getPlaylistPlaybackAvailability, normalizeMusicProviderName } from "@/features/music/utils/playback-availability";

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatCreatedAt(createdAt: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(createdAt));
}

function formatShortDate(value: Date) {
  const parsed = new Date(value);
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getDate()).padStart(2, "0");
  const yy = String(parsed.getFullYear()).slice(-2);
  return `${ mm }-${ dd }-${ yy }`;
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${ year }-${ month }-${ day }`;
}

function getMusicDocument(musicJson?: string): JSONContent {
  if (!musicJson) {
    return createEmptyTipTapDocument();
  }

  const parsed = parseSerializedTipTapDocument(musicJson);
  return parsed.success ? parsed.content : createEmptyTipTapDocument();
}

function getMusicTypeLabel(type: MusicRecord["musicType"]): "Song" | "Album" | "Playlist" {
  if (type === "song") {
    return "Song";
  }

  if (type === "playlist") {
    return "Playlist";
  }

  return "Album";
}

function getSpotifyTrackUrisFromPlaylistMedia(playlistMedia: MusicDetail["playlistMedia"]): string[] {
  const trackUris = new Set<string>();

  for (const media of playlistMedia) {
    if (media.mediaSource !== "spotify") {
      continue;
    }

    const match = media.mediaUrl.match(/spotify\.com\/track\/([A-Za-z0-9]+)/i)
      ?? media.mediaUrl.match(/spotify:track:([A-Za-z0-9]+)/i);

    if (!match?.[1]) {
      continue;
    }

    trackUris.add(`spotify:track:${ match[1] }`);
  }

  return Array.from(trackUris);
}

function MusicViewer({ musicJson, compact = false, minHeightClass, showLineNumbers = false }: { musicJson?: string; compact?: boolean; minHeightClass?: string; showLineNumbers?: boolean }) {
  const viewer = useEditor({
    editable: false,
    extensions: [
      StarterKit,
      Underline,
      LinkExtension.configure({ autolink: true, defaultProtocol: "https", openOnClick: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: getMusicDocument(musicJson),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: `tiptap ${ minHeightClass ?? (compact ? "min-h-56" : "min-h-112") } text-[#203b66] focus:outline-none`,
      },
    },
  });

  useEffect(() => {
    if (!viewer) {
      return;
    }

    viewer.commands.setContent(getMusicDocument(musicJson));
  }, [viewer, musicJson]);

  const lyricsLines = useMemo(() => {
    if (!showLineNumbers) {
      return [""];
    }

    const viewerText = viewer?.getText({ blockSeparator: "\n" }) ?? "";

    return viewerText.trim().length === 0 ? [""] : viewerText.split("\n");
  }, [showLineNumbers, viewer, musicJson]);

  const lineCount = lyricsLines.length;
  const useTwoColumnLyricsLayout = showLineNumbers && lineCount > 40;
  const lyricsSplitIndex = Math.ceil(lineCount / 2);
  const lyricsColumnOneLines = lyricsLines.slice(0, lyricsSplitIndex);
  const lyricsColumnTwoLines = lyricsLines.slice(lyricsSplitIndex);

  if (useTwoColumnLyricsLayout) {
    return (
      <div className="max-h-120 overflow-auto rounded-2xl border border-[#c8d9f3] bg-[#eef4ff] p-2">
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="overflow-hidden rounded-2xl border border-[#c8d9f3] bg-white">
            <div className="flex">
              <div className="w-12 shrink-0 border-r border-[#c8d9f3] bg-[#eef4ff] py-4 text-sm text-[#4b6ea8]">
                { lyricsColumnOneLines.map((_, index) => (
                  <div key={ index + 1 } className="min-h-6 text-center leading-6 tabular-nums">
                    { index + 1 }
                  </div>
                )) }
              </div>
              <div className="min-w-0 flex-1 px-4 py-4">
                { lyricsColumnOneLines.map((line, index) => (
                  <div key={ `left-${ index + 1 }` } className="min-h-6 text-sm leading-6 text-[#203b66] whitespace-pre-wrap wrap-break-word">
                    { line || "\u00A0" }
                  </div>
                )) }
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-[#c8d9f3] bg-white">
            <div className="flex">
              <div className="w-12 shrink-0 border-r border-[#c8d9f3] bg-[#eef4ff] py-4 text-sm text-[#4b6ea8]">
                { lyricsColumnTwoLines.map((_, index) => (
                  <div key={ lyricsSplitIndex + index + 1 } className="min-h-6 text-center leading-6 tabular-nums">
                    { lyricsSplitIndex + index + 1 }
                  </div>
                )) }
              </div>
              <div className="min-w-0 flex-1 px-4 py-4">
                { lyricsColumnTwoLines.map((line, index) => (
                  <div key={ `right-${ lyricsSplitIndex + index + 1 }` } className="min-h-6 text-sm leading-6 text-[#203b66] whitespace-pre-wrap wrap-break-word">
                    { line || "\u00A0" }
                  </div>
                )) }
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[#c8d9f3] bg-white [&_.tiptap_ul]:list-disc [&_.tiptap_ul]:pl-5 [&_.tiptap_ol]:list-decimal [&_.tiptap_ol]:pl-5 [&_.tiptap_li]:my-1 [&_.tiptap_hr]:my-4 [&_.tiptap_hr]:border-[#c8d9f3] [&_.tiptap_table]:w-full [&_.tiptap_table]:border-collapse [&_.tiptap_table]:border [&_.tiptap_table]:border-[#c8d9f3] [&_.tiptap_th]:border [&_.tiptap_th]:border-[#c8d9f3] [&_.tiptap_th]:bg-[#edf4ff] [&_.tiptap_th]:px-2 [&_.tiptap_th]:py-1 [&_.tiptap_th]:align-top [&_.tiptap_td]:border [&_.tiptap_td]:border-[#c8d9f3] [&_.tiptap_td]:px-2 [&_.tiptap_td]:py-1 [&_.tiptap_td]:align-top">
      <div className={ showLineNumbers ? "flex max-h-120 overflow-auto p-4" : "p-4" }>
        { showLineNumbers ? (
          <div className="w-11 shrink-0 border-r border-[#c8d9f3] bg-[#eef4ff] py-4 pr-2 text-base text-[#4b6ea8]">
            { Array.from({ length: Math.max(lineCount, 1) }, (_, index) => (
              <div key={ index + 1 } className="h-5 text-center leading-5 tabular-nums">
                { index + 1 }
              </div>
            )) }
          </div>
        ) : null }
        <EditorContent editor={ viewer } className={ showLineNumbers ? "min-w-0 flex-1 pl-4" : "" } />
      </div>
    </div>
  );
}



export function MusicHomePage({
  musics,
  member,
  initialGuidedLaunchPayload,
  hasSpotifyAccessToken,
  musicPlayerOptions,
}: {
  musics: MusicRecord[];
  member: MemberKeyDetails;
  initialGuidedLaunchPayload?: GuidedTourLaunchPayload | null;
  hasSpotifyAccessToken: boolean;
  musicPlayerOptions: Array<{ optionName: string; isSelected: boolean }>;
}) {
  const router = useRouter();
  const [isEngaging, startEngageTransition] = useTransition();
  const [selectedMusicDetail, setSelectedMusicDetail] = useState<MusicDetail | null>(null);
  const [commentText, setCommentText] = useState("");
  const [isSpotifyPlaybackBusy, setIsSpotifyPlaybackBusy] = useState(false);
  const [spotifyConnectionNeedsReconnect, setSpotifyConnectionNeedsReconnect] = useState(!hasSpotifyAccessToken);
  const [spotifyPlaybackState, setSpotifyPlaybackState] = useState<"idle" | "playing" | "paused">("idle");
  const [isViewMusicOpen, setIsViewMusicOpen] = useState(false);
  const [isSpotifyRequirementsHoverOpen, setIsSpotifyRequirementsHoverOpen] = useState(false);
  const [musicStripMode, setMusicStripMode] = useState<"all" | "latest" | "top-rated">("all");
  const [dateScope, setDateScope] = useState<"everything" | "date-range">("everything");
  const [searchValue, setSearchValue] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const canAccessDraftMusic = (musicMemberId: number) => musicMemberId === member.memberId || member.isFounder;
  const [startDate, setStartDate] = useState(() => {
    const today = new Date();
    const threeMonthsAgo = new Date(today);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    return toDateInputValue(threeMonthsAgo);
  });
  const [endDate, setEndDate] = useState(() => toDateInputValue(new Date()));
  const [appliedStartDate, setAppliedStartDate] = useState(startDate);
  const [appliedEndDate, setAppliedEndDate] = useState(endDate);
  const visibleMusics = musics.filter((music) => (
    music.status === "published"
    || (music.status === "draft" && canAccessDraftMusic(music.memberId))
    || (includeArchived && music.status === "archived")
  ));
  const [selectedMusic, setSelectedMusic] = useState(visibleMusics[0]?.id ?? 0);
  const [filterWithDiscussionThreads, setFilterWithDiscussionThreads] = useState(false);
  const isDateRangeScope = dateScope === "date-range";
  const hasPendingDateChanges = startDate !== appliedStartDate || endDate !== appliedEndDate;
  const startDateValue = isDateRangeScope && appliedStartDate ? new Date(`${ appliedStartDate }T00:00:00`) : null;
  const endDateValue = isDateRangeScope && appliedEndDate ? new Date(`${ appliedEndDate }T23:59:59.999`) : null;

  const filteredFinderMusics = visibleMusics.filter((music) => {
    const updatedAt = new Date(music.updatedAt);

    if (startDateValue && updatedAt < startDateValue) {
      return false;
    }

    if (endDateValue && updatedAt > endDateValue) {
      return false;
    }

    if (filterWithDiscussionThreads && !music.hasDiscussionThread) {
      return false;
    }

    const query = searchValue.trim().toLowerCase();
    if (!query) {
      return true;
    }

    return [
      music.musicTitle,
      music.artistName,
      ...(music.tagNamesByType.genre ?? []),
      ...(music.tagNamesByType.subGenre ?? []),
      music.musicType,
      music.submitterName,
    ].join(" ").toLowerCase().includes(query);
  });

  useEffect(() => {
    const flushQueuedMusicComments = async () => {
      if (!isBrowserOnline()) {
        return;
      }

      const queuedComments = readQueuedFeatureComments().filter((item) => item.kind === "music");

      for (const queuedComment of queuedComments) {
        const result = await addMusicCommentAction(queuedComment.payload);

        if (!result.success) {
          continue;
        }

        if (queuedComment.payload.clientRequestId) {
          clearQueuedFeatureComment(queuedComment.payload.clientRequestId);
        }

        if (selectedMusic === queuedComment.payload.musicId) {
          setSelectedMusicDetail(result.music);
        }
      }
    };

    void flushQueuedMusicComments();

    const handleSync = () => {
      void flushQueuedMusicComments();
    };

    window.addEventListener("online", handleSync);
    window.addEventListener(getPwaSyncNowEventName(), handleSync);

    return () => {
      window.removeEventListener("online", handleSync);
      window.removeEventListener(getPwaSyncNowEventName(), handleSync);
    };
  }, [selectedMusic]);

  const handlePlaySelectedPlaylist = async () => {
    if (!selectedMusicDetail) {
      return;
    }

    const trackUris = getSpotifyTrackUrisFromPlaylistMedia(selectedMusicDetail.playlistMedia);

    if (trackUris.length === 0) {
      toast.error("No Spotify track URLs were found for this playlist.");
      return;
    }

    setIsSpotifyPlaybackBusy(true);

    try {
      const result = spotifyPlaybackState === "paused"
        ? await resumeSpotifyPlaylistAction()
        : await playSpotifyPlaylistAction({ uris: trackUris });

      if (!result.success) {
        if ("code" in result && result.code === "reconnect_required") {
          setSpotifyConnectionNeedsReconnect(true);
        }
        toast.error(result.message);
        return;
      }

      setSpotifyPlaybackState("playing");
      toast.success(spotifyPlaybackState === "paused" ? "Playback resumed." : "Playlist playback started.");
    } finally {
      setIsSpotifyPlaybackBusy(false);
    }
  };

  const handleConnectSpotify = async () => {
    setIsSpotifyPlaybackBusy(true);

    try {
      const result = await prepareSpotifyConnectionAction();
      if (!result.success) {
        toast.error(result.message);
        return;
      }

      await signIn("spotify", { callbackUrl: "/music" }, { show_dialog: "true" });
    } finally {
      setIsSpotifyPlaybackBusy(false);
    }
  };

  const handlePauseSelectedPlaylist = async () => {
    setIsSpotifyPlaybackBusy(true);

    try {
      const result = await pauseSpotifyPlaylistAction();

      if (!result.success) {
        if ("code" in result && result.code === "reconnect_required") {
          setSpotifyConnectionNeedsReconnect(true);
        }
        toast.error(result.message);
        return;
      }

      setSpotifyPlaybackState("paused");
      toast.success("Playback paused.");
    } finally {
      setIsSpotifyPlaybackBusy(false);
    }
  };

  const handleStopSelectedPlaylist = async () => {
    setIsSpotifyPlaybackBusy(true);

    try {
      const result = await stopSpotifyPlaylistAction();

      if (!result.success) {
        if ("code" in result && result.code === "reconnect_required") {
          setSpotifyConnectionNeedsReconnect(true);
        }
        toast.error(result.message);
        return;
      }

      setSpotifyPlaybackState("idle");
      toast.success("Playback stopped.");
    } finally {
      setIsSpotifyPlaybackBusy(false);
    }
  };

  const handleSkipSelectedPlaylist = async (direction: "previous" | "next") => {
    setIsSpotifyPlaybackBusy(true);

    try {
      const result = direction === "previous"
        ? await skipToPreviousSpotifyTrackAction()
        : await skipToNextSpotifyTrackAction();

      if (!result.success) {
        if ("code" in result && result.code === "reconnect_required") {
          setSpotifyConnectionNeedsReconnect(true);
        }
        toast.error(result.message);
        return;
      }

      toast.success(direction === "previous" ? "Skipped to previous track." : "Skipped to next track.");
    } finally {
      setIsSpotifyPlaybackBusy(false);
    }
  };

  useEffect(() => {
    if (!selectedMusic) {
      return;
    }

    let isCancelled = false;

    startEngageTransition(async () => {
      const result = await getMusicDetailAction({ musicId: selectedMusic });
      if (isCancelled) {
        return;
      }
      if (!result.success) {
        setSelectedMusicDetail(null);
        return;
      }
      setSelectedMusicDetail(result.music);
    });

    return () => {
      isCancelled = true;
    };
  }, [selectedMusic]);

  const allMusics = [...filteredFinderMusics]
    .sort((leftMusic, rightMusic) => leftMusic.musicTitle.localeCompare(rightMusic.musicTitle, undefined, { sensitivity: "base" }))
    .map((music) => ({
      kind: "all" as const,
      id: music.id,
      name: music.musicTitle,
      status: music.status,
      date: formatShortDate(music.updatedAt),
      submitterName: music.submitterName,
      submitterImageUrl: music.submitterImageUrl,
      reviewType: getMusicTypeLabel(music.musicType),
      hasLyrics: Boolean(music.hasLyrics),
      submitterLikenessDegree: music.memberId === member.memberId ? null : music.submitterLikenessDegree,
      commentsCount: music.commentCount,
      thumbsUp: music.thumbsUpCount,
      love: music.loveCount,
      hasDiscussionThread: music.hasDiscussionThread,
      imageSrc: music.musicImageUrl ?? null,
      imageAlt: music.musicTitle,
    }));

  const latestMusics = [...filteredFinderMusics]
    .filter((music) => {
      const twoMonthsAgo = new Date();
      twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
      return new Date(music.updatedAt).getTime() >= twoMonthsAgo.getTime();
    })
    .sort((leftMusic, rightMusic) => +new Date(rightMusic.updatedAt) - +new Date(leftMusic.updatedAt))
    .slice(0, 8)
    .map((music) => ({
      kind: "latest" as const,
      id: music.id,
      name: music.musicTitle,
      status: music.status,
      date: formatShortDate(music.updatedAt),
      submitterName: music.submitterName,
      submitterImageUrl: music.submitterImageUrl,
      reviewType: getMusicTypeLabel(music.musicType),
      hasLyrics: Boolean(music.hasLyrics),
      submitterLikenessDegree: music.memberId === member.memberId ? null : music.submitterLikenessDegree,
      commentsCount: music.commentCount,
      thumbsUp: music.thumbsUpCount,
      love: music.loveCount,
      hasDiscussionThread: music.hasDiscussionThread,
      imageSrc: music.musicImageUrl ?? null,
      imageAlt: music.musicTitle,
    }));

  const topRatedMusics = [...filteredFinderMusics]
    .filter((music) => (music.thumbsUpCount + music.loveCount) > 0)
    .sort((leftMusic, rightMusic) => {
      const leftScore = leftMusic.thumbsUpCount + leftMusic.loveCount;
      const rightScore = rightMusic.thumbsUpCount + rightMusic.loveCount;
      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }
      return +new Date(rightMusic.updatedAt) - +new Date(leftMusic.updatedAt);
    })
    .slice(0, 8)
    .map((music) => ({
      kind: "top-rated" as const,
      id: music.id,
      name: music.musicTitle,
      status: music.status,
      date: formatShortDate(music.updatedAt),
      submitterName: music.submitterName,
      submitterImageUrl: music.submitterImageUrl,
      submitterLikenessDegree: music.memberId === member.memberId ? null : music.submitterLikenessDegree,
      noRating: music.noRatingCount,
      thumbsUp: music.thumbsUpCount,
      love: music.loveCount,
      commentsCount: music.commentCount,
      hasDiscussionThread: music.hasDiscussionThread,
      imageSrc: music.musicImageUrl ?? null,
      imageAlt: music.musicTitle,
    }));

  const stripItems = musicStripMode === "all" ? allMusics : musicStripMode === "latest" ? latestMusics : topRatedMusics;
  const stripTitle = musicStripMode === "all" ? "All Music" : musicStripMode === "latest" ? "Latest Music" : "Top Rated Music";
  const stripDescription = musicStripMode === "all"
    ? isDateRangeScope
      ? "All music posts in the selected date range, ordered by the most recently updated."
      : "All music posts (song, album, playlist), ordered by the most recently updated."
    : musicStripMode === "latest"
      ? isDateRangeScope
        ? "Newest music posts in the selected date range."
        : "Newest music posts overall."
      : isDateRangeScope
        ? "Top rated music in the selected date range."
        : "Top rated music based on total likes and loves.";
  const stripAccentClassName = musicStripMode === "all"
    ? "bg-[linear-gradient(135deg,#cdddf9,#dbe8ff)]"
    : musicStripMode === "latest"
      ? "bg-[linear-gradient(135deg,#4f7fd6,#2C5EAD)]"
      : "bg-[linear-gradient(135deg,#7aa0dd,#4a6fae)]";

  const preferredMusicPlayerName = musicPlayerOptions.find((option) => option.isSelected)?.optionName ?? null;
  const isSpotifyPreferredPlayer = normalizeMusicProviderName(preferredMusicPlayerName).includes("spotify");
  const selectedPlaylistPlaybackState = selectedMusicDetail && selectedMusicDetail.id === selectedMusic
    ? getPlaylistPlaybackAvailability({
        selectedProviderName: preferredMusicPlayerName,
        hasSpotifyAccessToken: hasSpotifyAccessToken && !spotifyConnectionNeedsReconnect,
        playlistMedia: selectedMusicDetail.playlistMedia,
      })
    : { canPlay: false, canPause: false, provider: "none" as const };
  const selectedMusicBasic = (selectedMusicDetail?.id === selectedMusic ? selectedMusicDetail : musics.find((music) => music.id === selectedMusic)) ?? visibleMusics[0] ?? null;
  const canReactToSelectedMusic = Boolean(selectedMusicBasic && selectedMusicBasic.memberId !== member.memberId);
  const canCommentOnSelectedMusic = canReactToSelectedMusic;
  const canEditSelectedMusic = Boolean(selectedMusicBasic && (selectedMusicBasic.memberId === member.memberId || member.isFounder));
  const canViewLyricsSelectedMusic = Boolean(
    selectedMusicBasic?.musicType === "song"
    && selectedMusicDetail?.id === selectedMusic
    && selectedMusicDetail.lyrics,
  );
  const selectedMusicLikenessDegree = selectedMusicDetail?.id === selectedMusic
    ? selectedMusicDetail.likenessDegree
    : (selectedMusicBasic?.likenessDegree ?? null);
  const selectedMusicNoRatingCount = selectedMusicDetail?.id === selectedMusic
    ? selectedMusicDetail.noRatingCount
    : (selectedMusicBasic?.noRatingCount ?? 0);
  const selectedMusicThumbsUpCount = selectedMusicDetail?.id === selectedMusic
    ? selectedMusicDetail.thumbsUpCount
    : (selectedMusicBasic?.thumbsUpCount ?? 0);
  const selectedMusicLoveCount = selectedMusicDetail?.id === selectedMusic
    ? selectedMusicDetail.loveCount
    : (selectedMusicBasic?.loveCount ?? 0);
  const selectedMusicType = selectedMusicBasic?.musicType ?? "album";
  const isSelectedPlaylist = selectedMusicType === "playlist";
  const isSelectedSong = selectedMusicType === "song";
  const selectedDiscussionThreads = selectedMusicDetail?.id === selectedMusic
    ? selectedMusicDetail.discussionThreads
    : (selectedMusicBasic?.discussionThreads ?? []);

  function handleSelectMusic(musicId: number) {
    setSelectedMusic(musicId);
    setSpotifyPlaybackState("idle");
  }

  function handleOpenMusicFromCard(musicId: number) {
    handleSelectMusic(musicId);
    setIsViewMusicOpen(true);
  }

  function handleApplyDateRange() {
    setAppliedStartDate(startDate);
    setAppliedEndDate(endDate);
    setDateScope("date-range");
  }

  function handleToggleLike(likenessDegree: number) {
    if (!selectedMusicBasic) {
      return;
    }

    if (selectedMusicBasic.memberId === member.memberId) {
      toast.error("You cannot react to your own music posting.");
      return;
    }

    startEngageTransition(async () => {
      const result = await toggleMusicLikeAction({ musicId: selectedMusicBasic.id, likenessDegree });
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      setSelectedMusicDetail(result.music);
      toast.success(result.message);
    });
  }

  function handleAddComment() {
    if (!selectedMusicBasic) {
      return;
    }

    if (!canCommentOnSelectedMusic) {
      toast.error("You cannot comment on your own music posting.");
      return;
    }

    const normalizedComment = normalizeSerializedTipTapDocument(commentText);
    if (isSerializedTipTapDocumentEmpty(normalizedComment)) {
      toast.error("Enter a comment before posting.");
      return;
    }

    startEngageTransition(async () => {
      const payload = {
        musicId: selectedMusicBasic.id,
        commentText: normalizedComment,
        clientRequestId: createClientRequestId("music-comment"),
      };
      const result = await addMusicCommentAction(payload);
      if (!result.success) {
        if (!isBrowserOnline()) {
          queueFeatureComment({
            kind: "music",
            payload,
            itemTitle: selectedMusicBasic.musicTitle,
            commenterName: `${ member.firstName } ${ member.lastName }`.trim(),
            queuedAt: new Date().toISOString(),
          });
          setCommentText("");
          toast.message("Comment saved locally. It will sync when you are back online.");
          return;
        }

        toast.error(result.message);
        return;
      }
      setSelectedMusicDetail(result.music);
      setCommentText("");
      toast.success(result.message);
    });
  }

  return (
    <FilterSidebarProvider palette={ musicFilterPalette }>
      <FilterSidebar title="Music Filters">
        <FilterSidebarSearch
          value={ searchValue }
          onChange={ setSearchValue }
          placeholder="Search by music title, genre, sub genre, type, or family member"
          ariaLabel="Search music"
        />
        <FilterSidebarDateScope
          radioName="music-date-scope"
          dateScope={ dateScope }
          onDateScopeChange={ setDateScope }
          startDate={ startDate }
          endDate={ endDate }
          onStartDateChange={ setStartDate }
          onEndDateChange={ setEndDate }
          isDateRangeScope={ isDateRangeScope }
          hasPendingChanges={ hasPendingDateChanges }
          onApply={ handleApplyDateRange }
        />
        <FilterSidebarGroup label="Music Type" className="flex flex-wrap gap-2">
          <FilterSidebarRadio name="music-strip-mode" value="all" checked={ musicStripMode === "all" } onChange={ () => setMusicStripMode("all") }>All</FilterSidebarRadio>
          <FilterSidebarRadio name="music-strip-mode" value="latest" checked={ musicStripMode === "latest" } onChange={ () => setMusicStripMode("latest") }>Latest</FilterSidebarRadio>
          <FilterSidebarRadio name="music-strip-mode" value="top-rated" checked={ musicStripMode === "top-rated" } onChange={ () => setMusicStripMode("top-rated") }>Top Rated</FilterSidebarRadio>
          <FilterSidebarCheckbox checked={ includeArchived } onChange={ setIncludeArchived }>Archived</FilterSidebarCheckbox>
          <FilterSidebarCheckbox checked={ filterWithDiscussionThreads } onChange={ setFilterWithDiscussionThreads }>Discussions</FilterSidebarCheckbox>
        </FilterSidebarGroup>
      </FilterSidebar>

      <section className="font-app min-w-0 flex-1 px-4 pb-8 pt-2 sm:px-6 sm:pt-4 md:px-8">
        <div id="music-home-page" className="mx-auto max-w-7xl space-y-3 sm:space-y-5">
        <div className="overflow-hidden rounded-[2rem] border border-white/70 bg-[linear-gradient(135deg,rgba(44,94,173,0.96),rgba(38,81,149,0.9)_56%,rgba(26,58,110,0.86))] px-4 py-5 text-white shadow-[0_28px_80px_-40px_rgba(15,36,74,0.8)] sm:px-8 sm:py-8 md:px-10">
          <div className="max-w-3xl">
            <p className="text-[1rem] font-bold uppercase tracking-[0.28em] text-[#dbe8ff]">Family Music Room</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <div id="music-go-home">
                <Link href="/" className="inline-flex items-center rounded-full border border-white/35 bg-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#eff5ff] transition hover:bg-white/25 sm:px-4 sm:py-2 sm:text-xs sm:tracking-[0.2em]"><HouseHeart className="mr-1.5 size-3.5 sm:mr-2 sm:size-4" />Go Home</Link>
              </div>
              <div id="music-templates">
                <Link href="/music/templates" className="inline-flex items-center rounded-full border border-white/35 bg-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#eff5ff] transition hover:bg-white/25 sm:px-4 sm:py-2 sm:text-xs sm:tracking-[0.2em]"><Edit3 className="mr-1 size-3 sm:size-3.5" />Music Templates</Link>
              </div>
            </div>
            {/* <h1 className="mt-3 text-base font-black leading-snug tracking-tight sm:mt-4 sm:text-3xl">Your family&apos;s favorite songs and lyrics in one place.</h1> */}
          </div>
        </div>

        <div className="overflow-hidden rounded-[1.9rem] border border-white/70 bg-white/82 shadow-[0_24px_70px_-40px_rgba(15,36,74,0.72)] backdrop-blur">
          <div className="border-b border-[#c8d9f3] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(239,245,255,0.9))] px-4 py-3.5 sm:px-6 sm:py-5">
            <p className="text-[0.68rem] font-bold uppercase tracking-[0.32em] text-[#2C5EAD]">Music Directory</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[#4a6fae]">
              <h2 className="text-2xl font-black tracking-tight text-[#203b66]">Music Finder</h2>
              <FeatureFaqHelp 
                  href="/feature-faq?category=Music%20Room" 
                  buttonClassName="h-4 w-4 md:h-7 md:w-7 border-[#c8d9f3] bg-gradient-to-b from-[#f7fbff] to-[#eaf1ff] text-[#2C5EAD]" 
                  iconClassName="h-3 w-3 text-[#2C5EAD]" 
                  tooltipClassName="bg-[#203b66] text-[#eff5ff]" 
              />
              <EditPostIcon tooltip="Filter Music" tooltipClassName="bg-[#203b66] text-[#eff5ff]"><FilterSidebarTrigger ariaLabel="Toggle music filters" /></EditPostIcon>
              <EditPostIcon tooltip="View Music" tooltipClassName="bg-[#203b66] text-[#eff5ff]"><Button type="button" onClick={ () => setIsViewMusicOpen(true) } disabled={ !selectedMusicBasic } className="h-8 rounded-full border border-[#c8d9f3] bg-[#f7fbff] px-2 text-xs font-semibold text-[#2C5EAD] sm:px-3" aria-label="View selected music"><Eye className="size-3.5" /><span className="hidden sm:inline">View</span></Button></EditPostIcon>
              { canViewLyricsSelectedMusic ? (
                <EditPostIcon tooltip="View Lyrics" tooltipClassName="bg-[#203b66] text-[#eff5ff]"><Button type="button" variant="outline" asChild className="h-8 rounded-full border-[#c8d9f3] bg-[#f7fbff] px-3 text-xs font-semibold text-[#2C5EAD] hover:bg-[#edf4ff] hover:text-[#2C5EAD]"><Link href={ `/music/lyrics?id=${ selectedMusic }` } aria-label="View selected lyrics"><Eye className="size-3.5" /><span className="hidden sm:inline">View Lyrics</span></Link></Button></EditPostIcon>
              ) : null }
              <EditPostIcon tooltip="Add Music" tooltipClassName="bg-[#203b66] text-[#eff5ff]"><Button type="button" variant="outline" asChild className="h-8 rounded-full border-[#c8d9f3] bg-[#f7fbff] px-2 text-xs font-semibold text-[#2C5EAD] hover:bg-[#edf4ff] hover:text-[#2C5EAD] sm:px-3"><Link href="/music/add-music" aria-label="Add music"><Plus className="size-3.5" /><span className="hidden sm:inline">Add</span></Link></Button></EditPostIcon>
              <EditPostIcon tooltip="Edit Music" tooltipClassName="bg-[#203b66] text-[#eff5ff]"><Button type="button" variant="outline" onClick={ () => router.push(`/music/add-music?id=${ selectedMusic }`) } disabled={ !canEditSelectedMusic } className="h-8 rounded-full border-[#c8d9f3] bg-[#f7fbff] px-2 text-xs font-semibold text-[#2C5EAD] hover:bg-[#edf4ff] hover:text-[#2C5EAD] disabled:opacity-50 sm:px-3" aria-label="Edit selected music"><Edit3 className="size-3.5" /><span className="hidden sm:inline">Edit Music</span></Button></EditPostIcon>
            </div>

            <div className="mt-1"><MusicScrollStrip title={ stripTitle } description={ stripDescription } items={ stripItems } accentClassName={ stripAccentClassName } selectedItemId={ selectedMusic } onSelectItem={ handleSelectMusic } onOpenItem={ handleOpenMusicFromCard } /></div>
          </div>
        </div>

        <Dialog
          open={ isViewMusicOpen }
          onOpenChange={ (isOpen) => {
            setIsViewMusicOpen(isOpen);
            setIsSpotifyRequirementsHoverOpen(false);
          } }
        >
          <DialogContent className="border-[#c8d9f3] bg-[#f7fbff] sm:max-w-5xl">
            <DialogHeader>
              <DialogTitle className="text-[#203b66]">{ selectedMusicBasic?.musicTitle ?? "Music" }</DialogTitle>
              <DialogDescription className="text-[#4a6fae]">
                { isSelectedPlaylist
                    ? "Playlist details, links, and family notes."
                    : isSelectedSong
                      ? "Song details, lyrics, and family notes."
                      : "Album details and family notes." }
              </DialogDescription>
            </DialogHeader>

            { selectedMusicBasic ? (
              <div className="max-h-[75vh] space-y-4 overflow-auto pr-1">
                <div className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
                  <div className="space-y-4">
                    <MusicViewer musicJson={ selectedMusicBasic.musicJson } compact={ isSelectedPlaylist } minHeightClass={ isSelectedPlaylist ? "min-h-24" : "min-h-44" } />
                  </div>
                  <div className="space-y-4">
                    <div className="overflow-hidden rounded-2xl border border-[#c8d9f3] bg-white">
                      <div className="relative aspect-16/10 overflow-hidden">
                        { selectedMusicBasic.musicImageUrl ? (
                          <ModalMusicImage
                            src={ selectedMusicBasic.musicImageUrl }
                            alt={ selectedMusicBasic.musicTitle }
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,#17324f,#315d8d_52%,#587fb1_100%)] px-5 py-6 text-center">
                            <div className="max-w-[92%] rounded-[1.3rem] border border-white/15 bg-black/20 px-4 py-3 shadow-[0_14px_32px_-20px_rgba(3,18,28,0.75)] backdrop-blur-[1px]">
                              <h3 className="max-w-full text-wrap text-3xl font-black leading-tight tracking-tight text-white drop-shadow-[0_2px_8px_rgba(4,24,34,0.58)]">
                                { selectedMusicBasic.musicTitle }
                              </h3>
                            </div>
                          </div>
                        ) }
                        <span className="absolute left-3 top-3 inline-flex" title={ selectedMusicBasic.submitterName }>
                          <MemberAvatar
                            imageUrl={ selectedMusicBasic.submitterImageUrl }
                            firstName={ selectedMusicBasic.submitterName }
                            sizeClassName="h-10 w-10"
                            chromeClassName="border-2 border-white shadow-md"
                          />
                        </span>
                      </div>
                    </div>
                    { !isSelectedPlaylist ? (
                      <div className="rounded-2xl border border-[#c8d9f3] bg-white p-4"><p className="text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[#2C5EAD]">Artist</p><p className="mt-2 text-sm leading-6 text-[#35557f]">{ selectedMusicBasic.artistName || "No artist provided." }</p></div>
                    ) : null }
                  </div>
                </div>

                { isSelectedPlaylist && selectedMusicDetail?.id === selectedMusic ? (
                  <div className="space-y-3 rounded-[1.4rem] border border-[#c8d9f3] bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <p className="text-[0.68rem] font-bold uppercase tracking-[0.32em] text-[#2C5EAD]">Playlist Media</p>
                        { selectedMusicDetail.playlistMedia.some((media) => media.mediaSource === "spotify") ? (
                          <HoverCard open={ isSpotifyRequirementsHoverOpen }>
                            <HoverCardTrigger asChild>
                              <button
                                type="button"
                                aria-label="Spotify playlist account requirements"
                                className="size-9 rounded-md shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C5EAD] focus-visible:ring-offset-2"
                                onPointerEnter={ () => setIsSpotifyRequirementsHoverOpen(true) }
                                onPointerLeave={ () => setIsSpotifyRequirementsHoverOpen(false) }
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src="/icons/spotify-icon.png" alt="" className="size-9 rounded-md object-cover" />
                              </button>
                            </HoverCardTrigger>
                            <HoverCardContent side="top" align="start" className="w-64 space-y-2 border-[#c8d9f3] bg-[#f7fbff] p-3 text-xs leading-5 text-[#35557f]">
                              <p>You must have a Spotify account and sign in with Spotify to play this playlist.</p>
                              <p> If you have a Spotify account, don&apos;t forget to update the <i>Preferred Music Player</i> in your profile settings.</p>
                            </HoverCardContent>
                          </HoverCard>
                        ) : null }
                        { selectedMusicDetail.playlistMedia.some((media) => media.mediaSource === "apple_play") ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src="/icons/apple-music-icon.jpg" alt="Apple Music playlist" title="Apple Music" className="size-6 rounded-md object-cover shadow-sm" />
                        ) : null }
                      </div>
                      { selectedMusicDetail.playlistMedia.some((media) => media.mediaSource === "spotify") ? (
                        <div className="flex flex-wrap items-center gap-2">
                          { isSpotifyPreferredPlayer && spotifyConnectionNeedsReconnect ? (
                            <Button
                              type="button"
                              variant="outline"
                              onClick={ handleConnectSpotify }
                              disabled={ isSpotifyPlaybackBusy }
                              className="h-9 border-[#1DB954] bg-white px-3 text-[#137a38] hover:bg-[#eaf8ef] hover:text-[#0d642d]"
                            >
                              { hasSpotifyAccessToken ? "Reconnect Spotify" : "Connect Spotify" }
                            </Button>
                          ) : null }
                          <Button
                            type="button"
                            size="icon"
                            onClick={ handlePlaySelectedPlaylist }
                            disabled={ isSpotifyPlaybackBusy || !selectedPlaylistPlaybackState.canPlay }
                            className="size-9 rounded-full bg-[#2C5EAD] text-white hover:bg-[#214e9d] disabled:opacity-50"
                            aria-label={ spotifyPlaybackState === "paused" ? "Resume playlist" : "Play playlist" }
                            title={ selectedPlaylistPlaybackState.canPlay ? (spotifyPlaybackState === "paused" ? "Resume" : "Play") : "Select Spotify as your preferred music player and verify your Spotify session is connected." }
                          >
                            <Play className="size-4 fill-current" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            onClick={ () => handleSkipSelectedPlaylist("previous") }
                            disabled={ isSpotifyPlaybackBusy || !selectedPlaylistPlaybackState.canPlay }
                            className="size-9 rounded-full border-[#9db8e2] text-[#2C5EAD] hover:bg-[#edf4ff] hover:text-[#214e9d]"
                            aria-label="Skip to previous track"
                            title="Previous"
                          >
                            <SkipBack className="size-4 fill-current" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            onClick={ handlePauseSelectedPlaylist }
                            disabled={ isSpotifyPlaybackBusy || !selectedPlaylistPlaybackState.canPause }
                            className="size-9 rounded-full border-[#9db8e2] text-[#2C5EAD] hover:bg-[#edf4ff] hover:text-[#214e9d]"
                            aria-label="Pause playlist"
                            title={ selectedPlaylistPlaybackState.canPause ? "Pause" : "Select Spotify as your preferred music player and verify your Spotify session is connected." }
                          >
                            <Pause className="size-4 fill-current" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            onClick={ handleStopSelectedPlaylist }
                            disabled={ isSpotifyPlaybackBusy || !selectedPlaylistPlaybackState.canPause }
                            className="size-9 rounded-full border-[#9db8e2] text-[#2C5EAD] hover:bg-[#edf4ff] hover:text-[#214e9d]"
                            aria-label="Stop playlist"
                            title="Stop"
                          >
                            <Square className="size-3.5 fill-current" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            onClick={ () => handleSkipSelectedPlaylist("next") }
                            disabled={ isSpotifyPlaybackBusy || !selectedPlaylistPlaybackState.canPlay }
                            className="size-9 rounded-full border-[#9db8e2] text-[#2C5EAD] hover:bg-[#edf4ff] hover:text-[#214e9d]"
                            aria-label="Skip to next track"
                            title="Next"
                          >
                            <SkipForward className="size-4 fill-current" />
                          </Button>
                          { !selectedPlaylistPlaybackState.canPlay ? (
                            <HoverCard>
                              <HoverCardTrigger asChild>
                                <button
                                  type="button"
                                  aria-label="Why are these playback buttons disabled?"
                                  className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[#c8d9f3] bg-white shadow-sm transition hover:bg-[#edf4ff]"
                                >
                                  <CircleQuestionMark className="h-3.5 w-3.5 text-[#2C5EAD]" />
                                </button>
                              </HoverCardTrigger>
                              <HoverCardContent side="left" align="center" className="w-64 border-[#c8d9f3] bg-[#f7fbff] p-3 text-xs leading-5 text-[#35557f]">
                                { !isSpotifyPreferredPlayer
                                  ? "These buttons are disabled because Spotify is not selected as your preferred music player. Choose Spotify in your member account settings."
                                  : spotifyConnectionNeedsReconnect
                                    ? "Connect Spotify to this My Family Social account to enable playback."
                                    : "No Spotify tracks were found for this playlist." }
                              </HoverCardContent>
                            </HoverCard>
                          ) : null }
                        </div>
                      ) : null }
                    </div>
                    { selectedMusicDetail.playlistMedia.length === 0 ? (
                      <p className="text-sm text-[#4a6fae]">No media links were provided.</p>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-4">
                        { [...selectedMusicDetail.playlistMedia]
                          .sort((leftMedia, rightMedia) => {
                            if (leftMedia.mediaSeqNo !== rightMedia.mediaSeqNo) {
                              return leftMedia.mediaSeqNo - rightMedia.mediaSeqNo;
                            }

                            return leftMedia.id - rightMedia.id;
                          })
                          .map((media) => (
                          <article key={ media.id } className="rounded-xl border border-[#c8d9f3] bg-[#f7fbff] p-3 text-sm text-[#35557f]">
                            <div className="flex items-center gap-3">
                              <div className="min-w-0 flex-1">
                                <a href={ media.mediaUrl } target="_blank" rel="noreferrer" className="inline-block break-all text-[#2C5EAD] underline decoration-[#7aa6ef] underline-offset-2">
                                  { media.mediaCaption || "Open media" }
                                </a>
                                { media.mediaArtist ? <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[#4a6fae]">{ media.mediaArtist }</p> : null }
                              </div>

                              <div className="shrink-0">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={ media.mediaImageUrl && media.useImageUrl ? media.mediaImageUrl : (media.mediaSource === "apple_play" ? "/icons/apple-music-icon.jpg" : "/icons/spotify-icon.png") }
                                  alt={ media.mediaSource === "apple_play" ? "Apple Music" : "Spotify" }
                                  className="h-16 w-16 rounded-lg object-cover shadow-sm ring-2 ring-[#dfeafc]"
                                />
                              </div>
                            </div>
                          </article>
                        )) }
                      </div>
                    ) }
                  </div>
                ) : null }

                { isSelectedSong && selectedMusicDetail?.id === selectedMusic && selectedMusicDetail.lyrics ? (
                  <div className="space-y-3 rounded-[1.4rem] border border-[#c8d9f3] bg-white p-4">
                    <div>
                      <p className="text-[0.68rem] font-bold uppercase tracking-[0.32em] text-[#2C5EAD]">Lyrics</p>
                    </div>
                    <MusicViewer musicJson={ selectedMusicDetail.lyrics.lyricsJson } showLineNumbers />
                  </div>
                ) : null }

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-[#c8d9f3] bg-white p-4">
                    <p className="text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[#2C5EAD]">Tags</p>
                    <div className="mt-3 grid gap-3 text-sm text-[#35557f] sm:grid-cols-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#4a6fae]">Genre</p>
                        { selectedMusicBasic.tagNamesByType.genre?.length ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            { selectedMusicBasic.tagNamesByType.genre.map((tagName) => (
                              <span key={ tagName } className="rounded-full border border-[#c8d9f3] bg-[#f7fbff] px-3 py-1 text-xs font-semibold text-[#203b66]">
                                { tagName }
                              </span>
                            )) }
                          </div>
                        ) : (
                          <p className="mt-1 text-xs text-[#4a6fae]">No genre tags selected.</p>
                        ) }
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#4a6fae]">Sub-Genre</p>
                        { selectedMusicBasic.tagNamesByType.subGenre?.length ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            { selectedMusicBasic.tagNamesByType.subGenre.map((tagName) => (
                              <span key={ tagName } className="rounded-full border border-[#c8d9f3] bg-[#f7fbff] px-3 py-1 text-xs font-semibold text-[#203b66]">
                                { tagName }
                              </span>
                            )) }
                          </div>
                        ) : (
                          <p className="mt-1 text-xs text-[#4a6fae]">No sub-genre tags selected.</p>
                        ) }
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-[1.4rem] border border-[#c8d9f3] bg-[#f7fbff] p-4">
                    <div>
                      <p className="text-[0.68rem] font-bold uppercase tracking-[0.32em] text-[#2C5EAD]">Family Reactions</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        onClick={ () => handleToggleLike(-1) }
                        disabled={ !selectedMusicBasic || isEngaging || !canReactToSelectedMusic }
                        className="rounded-full bg-[#5c6c76] text-white hover:bg-[#4c5961]"
                        aria-label={ selectedMusicLikenessDegree === -1 ? "Remove thumbs down" : "Add thumbs down" }
                      >
                        <ThumbsDown className={ `size-4 ${ selectedMusicLikenessDegree === -1 ? "fill-white" : "" }` } />
                      </Button>
                      <Button
                        type="button"
                        onClick={ () => handleToggleLike(1) }
                        disabled={ !selectedMusicBasic || isEngaging || !canReactToSelectedMusic }
                        className="rounded-full bg-[#2d87a8] text-white hover:bg-[#256e89]"
                        aria-label={ selectedMusicLikenessDegree === 1 ? "Remove thumbs up" : "Add thumbs up" }
                      >
                        <ThumbsUp className={ `size-4 ${ selectedMusicLikenessDegree === 1 ? "fill-white" : "" }` } />
                      </Button>
                      <Button
                        type="button"
                        onClick={ () => handleToggleLike(2) }
                        disabled={ !selectedMusicBasic || isEngaging || !canReactToSelectedMusic }
                        className="rounded-full bg-[#cf3f7f] text-white hover:bg-[#aa3368]"
                        aria-label={ selectedMusicLikenessDegree === 2 ? "Remove love" : "Add love" }
                      >
                        <Heart className={ `size-4 ${ selectedMusicLikenessDegree === 2 ? "fill-white" : "" }` } />
                      </Button>
                    </div>
                    { !canReactToSelectedMusic ? (
                      <p className="text-xs text-[#4a6fae]">
                        You cannot react to your own music posting. Ask another family member to react to it.
                      </p>
                    ) : null }
                    <div className="flex flex-wrap items-center gap-4">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-[#5c6c76]">
                        <ThumbsDown className="size-4 text-[#5c6c76]" />
                        { selectedMusicNoRatingCount.toLocaleString() }
                      </span>
                      <span className="inline-flex items-center gap-1.5 font-semibold text-[#245475]">
                        <ThumbsUp className="size-4 text-[#2d87a8]" />
                        { selectedMusicThumbsUpCount.toLocaleString() }
                      </span>
                      <span className="inline-flex items-center gap-1.5 font-semibold text-[#8f2f58]">
                        <Heart className="size-4 fill-[#cf3f7f] text-[#cf3f7f]" />
                        { selectedMusicLoveCount.toLocaleString() }
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 rounded-[1.4rem] border border-[#c8d9f3] bg-[#f7fbff] p-4">
                  <div>
                    <p className="text-[0.68rem] font-bold uppercase tracking-[0.32em] text-[#2C5EAD]">Family Comments</p>
                    <p className="text-xs text-[#4a6fae]">Share your thoughts about this music with your family.</p>
                  </div>
                  <div className="space-y-2">
                    { selectedMusicDetail?.id === selectedMusic && selectedMusicDetail.musicComments.length === 0 ? (
                      <p className="rounded-2xl border border-dashed border-[#c8d9f3] bg-white px-3 py-2 text-sm text-[#4a6fae]">No comments yet. Be the first family member to add one.</p>
                    ) : selectedMusicDetail?.id !== selectedMusic ? (
                      <p className="rounded-2xl border border-dashed border-[#c8d9f3] bg-white px-3 py-2 text-sm text-[#4a6fae]">Loading comments...</p>
                    ) : (
                      (selectedMusicDetail?.musicComments ?? []).map((comment) => (
                        <article key={ comment.id } className="rounded-2xl border border-[#c8d9f3] bg-white px-3 py-3 text-sm text-[#35557f]">
                          <div className="[&_.tiptap]:text-[#203b66] [&_.tiptap_a]:text-[#2C5EAD] [&_.tiptap_th]:bg-[#edf4ff] [&_.tiptap_th]:text-[#203b66] [&_.tiptap_td]:text-[#203b66]">
                            <TiptapRenderer contentJson={ comment.commentJson } />
                          </div>
                          <p className="mt-2 text-xs uppercase tracking-[0.16em] text-[#4a6fae]">{ comment.commenterName } · { formatCreatedAt(comment.createdAt) }</p>
                        </article>
                      ))
                    ) }
                  </div>

                  { canCommentOnSelectedMusic ? (
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-[#203b66]" htmlFor="music-comment-input-dialog">Add Comment</label>
                      <div id="music-comment-input-dialog">
                        <TipTapCommentEditor
                          value={ commentText }
                          onChange={ setCommentText }
                          placeholder="What did you think about this song, album, or playlist?"
                          disabled={ !selectedMusicBasic || isEngaging }
                          toolbarClassName="border-[#c8d9f3] bg-[#edf4ff]"
                          editorClassName="border-[#c8d9f3] text-[#203b66]"
                          buttonClassName="border-[#9eb9e8] text-[#2C5EAD]"
                          activeButtonClassName="border-[#2C5EAD] bg-[#dbe8ff] text-[#203b66]"
                        />
                      </div>
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          onClick={ handleAddComment }
                          disabled={ !selectedMusicBasic || isEngaging || isSerializedTipTapDocumentEmpty(commentText) }
                          className="rounded-full bg-[#2C5EAD] text-white hover:bg-[#234c8e]"
                        >
                          Post Comment
                        </Button>
                      </div>
                    </div>
                  ) : null }
                </div>

                <div className="space-y-3 rounded-[1.4rem] border border-[#c8d9f3] bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="text-[0.68rem] font-bold uppercase tracking-[0.32em] text-[#2C5EAD]">Discussion Threads</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <StartDiscussionDialog
                        targetType="music"
                        targetId={ selectedMusicBasic.id }
                        topicLabel={ `${ selectedMusicBasic.musicTitle } Discussion ${ selectedDiscussionThreads.length + 1 }` }
                        revalidatePaths={ ["/music"] }
                        onSuccessRoute="/music/discussions/:threadId"
                        disabled={ isEngaging || selectedMusicDetail?.id !== selectedMusic }
                        triggerLabel="Add Discussion Group"
                        triggerClassName="rounded-full bg-[#2C5EAD] px-4 text-xs font-semibold text-white hover:bg-[#234c8e]"
                      />
                    </div>
                  </div>
                  { selectedMusicDetail?.id !== selectedMusic ? (
                    <p className="text-sm text-[#4a6fae]">Loading discussion threads...</p>
                  ) : selectedMusicDetail.discussionThreads.length === 0 ? (
                    <p className="text-sm text-[#4a6fae]">No discussion threads have been added for this music yet.</p>
                  ) : (
                    <div className="space-y-3">
                      { selectedMusicDetail.discussionThreads.map((discussionThread) => (
                        <article key={ discussionThread.id } className="rounded-2xl border border-[#c8d9f3] bg-[#f7fbff] px-4 py-4 text-sm text-[#35557f] shadow-sm">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1 space-y-1">
                              <p className="text-base font-bold leading-snug text-[#203b66]">{ discussionThread.discussTopic }</p>
                              <p className="text-xs uppercase tracking-[0.16em] text-[#4a6fae]">
                                { discussionThread.memberFirstName } · { formatCreatedAt(discussionThread.createdAt) }
                              </p>
                            </div>

                            <div className="flex shrink-0 flex-wrap items-center gap-3">
                              { discussionThread.dislikeCount > 0 || discussionThread.likeCount > 0 || discussionThread.loveCount > 0 ? (
                                <div className="flex flex-wrap items-center gap-2">
                                  { discussionThread.dislikeCount > 0 ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-[#eef2f8] px-2 py-1 text-[0.65rem] font-semibold text-[#4a5f7a]">
                                      <ThumbsDown className="size-3" />
                                      { discussionThread.dislikeCount }
                                    </span>
                                  ) : null }
                                  { discussionThread.likeCount > 0 ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-[#e7f0ff] px-2 py-1 text-[0.65rem] font-semibold text-[#2C5EAD]">
                                      <ThumbsUp className="size-3" />
                                      { discussionThread.likeCount }
                                    </span>
                                  ) : null }
                                  { discussionThread.loveCount > 0 ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-[#fde4ee] px-2 py-1 text-[0.65rem] font-semibold text-[#aa3368]">
                                      <Heart className="size-3 fill-current" />
                                      { discussionThread.loveCount }
                                    </span>
                                  ) : null }
                                </div>
                              ) : null }

                              <Button
                                type="button"
                                variant="outline"
                                asChild
                                className="shrink-0 rounded-full border-[#9eb9e8] bg-white px-4 text-xs font-semibold text-[#203b66] hover:bg-[#edf4ff]"
                              >
                                <Link href={ `/music/discussions/${ discussionThread.id }` }>
                                  View
                                </Link>
                              </Button>
                            </div>
                          </div>
                        </article>
                      )) }
                    </div>
                  ) }
                </div>
              </div>
            ) : null }
          </DialogContent>
        </Dialog>
          </div>
        </section>
      <GuidedTourLauncher initialPayload={ initialGuidedLaunchPayload } tourKey="music_salon" />
    </FilterSidebarProvider>
  );
}

function ModalMusicImage({ src, alt }: { src: string; alt: string }) {
  const [resolvedSrc, setResolvedSrc] = useState(src);

  useEffect(() => {
    let isCancelled = false;

    const resolveSignedUrl = async () => {
      const key = extractS3KeyFromValue(src);

      if (!key) {
        if (!isCancelled) {
          setResolvedSrc(src);
        }
        return;
      }

      try {
        const response = await fetch("/api/s3-upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "download",
            fileName: key,
          }),
        });

        if (!response.ok) {
          if (!isCancelled) {
            setResolvedSrc(src);
          }
          return;
        }

        const body = await response.json();

        if (!isCancelled) {
          setResolvedSrc(body.url ?? src);
        }
      } catch {
        if (!isCancelled) {
          setResolvedSrc(src);
        }
      }
    };

    void resolveSignedUrl();

    return () => {
      isCancelled = true;
    };
  }, [src]);

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={ resolvedSrc } alt={ alt } className="h-full w-full object-cover" />;
}
